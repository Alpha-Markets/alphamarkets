import type { Address } from "@alphamarkets/types";
import { AlphaMarketsError } from "./errors.js";
import type { OptionsNamespace, OptionsQuoteResult, SignedQuote } from "./options.js";
import type { OracleNamespace } from "./oracle.js";
import { analyzeStrategy, strategyLegs, type OptionQuote, type StrategyAnalysis, type StrategyKind, type StrategyStrikes } from "./strategies.js";
import type { PreparedTx, TradingNamespace } from "./trading.js";
import { fromBaseUnits } from "./amounts.js";
import { toUnixSeconds } from "./utils.js";

/// Structured products (PROJECT_BRIEF.md Section 40): packaged positions built from the instruments
/// the protocol already has, opened together, all or nothing, through a subaccount's `multicall`.
/// A product is a named strategy with a terms sheet (net premium, max profit and loss, break-evens,
/// Greeks) and the prepared transactions that open it. There is no separate pooled product contract:
/// the position belongs to the subaccount that opens it, and can be closed leg by leg like any other.
///
/// Only strategies whose every leg the contracts can open today are offered: `OptionsEngine` lets a
/// user BUY options only, so a covered call, a spread or an iron condor is not a product yet (they
/// are in `strategies` as analytics).
export type StructuredKind = "PROTECTED_LONG" | "BREAKOUT_STRADDLE" | "BREAKOUT_STRANGLE";

export const STRUCTURED_KINDS: StructuredKind[] = ["PROTECTED_LONG", "BREAKOUT_STRADDLE", "BREAKOUT_STRANGLE"];

const STRATEGY_OF: Record<StructuredKind, StrategyKind> = {
  PROTECTED_LONG: "PROTECTIVE_PUT",
  BREAKOUT_STRADDLE: "STRADDLE",
  BREAKOUT_STRANGLE: "STRANGLE",
};

/// One line per product, for a terms sheet.
export const STRUCTURED_SUMMARY: Record<StructuredKind, string> = {
  PROTECTED_LONG: "A 1x long perpetual plus a put. The loss is floored at the put's strike, for the price of the put.",
  BREAKOUT_STRADDLE: "A call and a put at one strike. Profits from a large move either way; loses the premium if the price stays put.",
  BREAKOUT_STRANGLE: "A put below and a call above the price. A cheaper bet on a large move, which has to be larger to pay.",
};

export interface StructuredRequest {
  kind: StructuredKind;
  /// Underlying symbol.
  market: string;
  /// Expiry of the option legs: unix seconds, `Date` or ISO string.
  expiry: bigint | Date | string;
  /// Strikes as plain decimals: `strike` for a straddle, `putStrike` for a protected long,
  /// `putStrike` and `callStrike` for a strangle.
  strikes: StrategyStrikes;
  /// Whole option contracts per option leg. The underlying leg of a protected long covers the same
  /// number of underlying units.
  contracts: bigint;
  /// The address that will execute the calls (a subaccount): each option quote is signed for it, so
  /// only it can spend them.
  trader: Address;
  /// Price bound on the perpetual leg, basis points from the mark. Default 50.
  slippageBps?: number;
}

export interface StructuredProduct {
  kind: StructuredKind;
  summary: string;
  /// The terms sheet.
  analysis: StrategyAnalysis;
  /// In order: the perpetual leg (protected long only), then each option leg. Send with
  /// `subaccounts.multicall(trader, calls)` so they open together or not at all.
  calls: PreparedTx[];
  /// Total premium for the option legs, settlement-token base units, as signed.
  optionPremium: bigint;
  /// The earliest time any signed option quote lapses: open before it.
  validUntil: bigint;
}

export interface StructuredNamespace {
  kinds(): StructuredKind[];
  /// Prices every leg, signs the option quotes for `trader`, and prepares the transactions.
  build(request: StructuredRequest): Promise<StructuredProduct>;
}

export interface StructuredDeps {
  options: OptionsNamespace;
  trading: TradingNamespace;
  oracle: OracleNamespace;
  decimals: () => Promise<number>;
}

export function createStructured(deps: StructuredDeps): StructuredNamespace {
  const { options, trading, oracle } = deps;

  return {
    kinds: () => [...STRUCTURED_KINDS],

    async build(request) {
      if (!STRUCTURED_KINDS.includes(request.kind)) throw new AlphaMarketsError(`structured: unknown product ${String(request.kind)}`);
      if (request.contracts <= 0n) throw new AlphaMarketsError("structured: contracts must be above zero");
      const expiry = toUnixSeconds(request.expiry);

      const [index, contractSize, settlementDecimals] = await Promise.all([oracle.getIndexPrice(request.market), options.contractSize(request.market), deps.decimals()]);
      const spot = Number(fromBaseUnits(index.price, 18));
      const units = Number(request.contracts) * (Number(contractSize) / 1e18);

      // Work out which option legs the strategy needs, then quote each one for the trader.
      const wanted = new Map<string, { type: "CALL" | "PUT"; strike: number }>();
      const probe = strategyLegs(STRATEGY_OF[request.kind], request.strikes, {
        spot,
        quantity: units,
        quote: (type, strike) => {
          wanted.set(`${type}-${strike}`, { type, strike });
          return { mark: 0 };
        },
      });
      const quoted = new Map<string, OptionsQuoteResult>();
      await Promise.all(
        [...wanted].map(async ([key, leg]) => {
          const quote = await options.quote({ underlying: request.market, type: leg.type, strike: leg.strike.toString(), expiry, contracts: request.contracts, user: request.trader });
          if (!quote.authorization) throw new AlphaMarketsError(`structured: the pricing service did not sign the ${leg.type} ${leg.strike} quote (does it hold a quoter key?)`);
          quoted.set(key, quote);
        }),
      );

      const lookup = (type: "CALL" | "PUT", strike: number): OptionQuote => {
        const quote = quoted.get(`${type}-${strike}`)!;
        return { mark: quote.premium, bid: quote.bid, ask: quote.ask, greeks: { delta: quote.delta, gamma: quote.gamma, theta: quote.theta / 365, vega: quote.vega / 100 } };
      };
      const legs = strategyLegs(STRATEGY_OF[request.kind], request.strikes, { spot, quantity: units, quote: lookup });
      const analysis = analyzeStrategy(legs);
      if (!analysis.executable) throw new AlphaMarketsError(`structured: ${request.kind} has a leg the contracts cannot open yet`);

      const calls: PreparedTx[] = [];
      for (const leg of probe) {
        if (leg.kind !== "UNDERLYING") continue;
        // A 1x long perpetual: margin equals the notional, in settlement-token units.
        const notional = (units * spot).toFixed(settlementDecimals);
        calls.push(await trading.prepareOpenPerp({ market: request.market, side: "LONG", collateral: notional, leverage: 1, slippageBps: request.slippageBps }));
      }

      let optionPremium = 0n;
      let validUntil: bigint | undefined;
      for (const leg of legs) {
        if (leg.kind === "UNDERLYING") continue;
        const quote = quoted.get(`${leg.kind}-${leg.strike}`)!;
        const authorization = quote.authorization as SignedQuote;
        optionPremium += authorization.premium;
        validUntil = validUntil === undefined || authorization.validUntil < validUntil ? authorization.validUntil : validUntil;
        calls.push(trading.prepareOpenOption({ underlying: request.market, type: leg.kind as "CALL" | "PUT", strike: leg.strike!.toString(), expiry, contracts: request.contracts, authorization }));
      }

      return { kind: request.kind, summary: STRUCTURED_SUMMARY[request.kind], analysis, calls, optionPremium, validUntil: validUntil ?? 0n };
    },
  };
}
