import type { ContractAddresses } from "@orionis/config";
import { OptionType, type Address, type Hex } from "@orionis/types";
import { optionMarketAbi, optionsEngineAbi, vaultAbi } from "./abis.js";
import { convertDecimals, fromBaseUnits, PRICE_DECIMALS, toBaseUnits, type Amount } from "./amounts.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError, OrionisError, type OrionisContractError } from "./errors.js";
import type { FeesNamespace } from "./fees.js";
import { applyBps, feeFromBps } from "./math.js";
import type { MarketsNamespace } from "./markets.js";
import { collectRiskViolations } from "./risk.js";
import { executeTx, type TxOptions } from "./transactions.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

const WAD = 10n ** 18n;

export type OptionSide = "CALL" | "PUT";

/// Default slippage allowed between the previewed premium and the premium submitted.
export const DEFAULT_PREMIUM_SLIPPAGE_BPS = 100;

export interface OptionSeriesParams {
  /// Underlying symbol ("NVDA") or bytes32 market id.
  underlying: string;
  type: OptionSide;
  /// Strike price: decimal string (`"190"`) or 18-decimal base-unit `bigint`.
  strike: Amount;
  /// Unix seconds, `Date`, or ISO date string ("2026-09-25").
  expiry: bigint | Date | string;
  contracts: number | bigint;
}

export type OptionsQuoteParams = OptionSeriesParams;

/// Response of `POST /v1/options/quote` (PROJECT_BRIEF.md Section 10). Display/quoting only —
/// these floats are never the source of settlement truth.
export interface OptionsQuoteResult {
  premium: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  breakEven: number;
  spot: number;
}

export interface OpenOptionPositionParams extends OptionSeriesParams {
  /// Total premium for the whole order in settlement-token units — take it from
  /// {@link OptionsNamespace.previewOpen}. Decimal string or base-unit `bigint`.
  premium: Amount;
  /// Highest total premium accepted onchain. Defaults to `premium` plus `slippageBps`.
  maxPremium?: Amount;
  slippageBps?: number;
  deadline?: bigint | Date | string;
  tx?: TxOptions;
}

export interface CloseOptionPositionParams {
  /// Total premium being received for the position, settlement-token units.
  premium: Amount;
  /// Lowest total premium accepted onchain. Defaults to `premium` less `slippageBps`.
  minPremium?: Amount;
  slippageBps?: number;
  deadline?: bigint | Date | string;
  tx?: TxOptions;
}

export interface OptionOpenPreview {
  marketId: Hex;
  type: OptionSide;
  /// 18-decimal fixed point.
  strike: bigint;
  expiry: bigint;
  contracts: bigint;
  /// Underlying units per contract, 18 decimals (OptionMarket).
  contractSize: bigint;
  quote: OptionsQuoteResult;
  /// Total premium for the order, settlement-token units. Pass this to `openPosition`.
  premium: bigint;
  fee: bigint;
  feeBps: bigint;
  /// `premium + fee` — what must be available in the Vault.
  totalRequired: bigint;
  /// Underlying price at which the position breaks even at expiry, 18 decimals.
  breakEven: bigint;
  /// Buyer's worst case: the whole premium plus the fee, settlement-token units.
  maxLoss: bigint;
  /// `null` for calls (unbounded); for puts, the payout if the underlying goes to zero less
  /// what was paid, settlement-token units.
  maxProfit: bigint | null;
  availableBalance?: bigint;
  sufficientCollateral?: boolean;
  violations: OrionisContractError[];
}

export interface OptionSeries {
  seriesId: Hex;
  expiry: bigint;
  strike: bigint;
  optionType: OptionType;
}

export interface OptionsNamespace {
  /// Expiries with at least one opened series, from `services/indexer` via the API. Requires
  /// `apiUrl`. This contract design has no pre-listed strike matrix — see `services/api`.
  expiries(underlying: string): Promise<bigint[]>;
  chain(underlying: string, expiry?: bigint | Date | string): Promise<OptionSeries[]>;
  /// Premium/IV/Greeks come from `services/pricing`, reached through `services/api`'s
  /// `POST /v1/options/quote` — requires `apiUrl`. This SDK never computes analytics itself:
  /// offchain analytics must never become the source of settlement truth, so there is no
  /// client-side fallback pricing model.
  quote(params: OptionsQuoteParams): Promise<OptionsQuoteResult>;
  /// Everything PROJECT_BRIEF.md Section 45 requires before signing an options order. Requires
  /// `apiUrl` (for the quote). Pass `user` to also check the Vault balance.
  previewOpen(params: OptionSeriesParams & { user?: Address }): Promise<OptionOpenPreview>;
  openPosition(params: OpenOptionPositionParams): Promise<{ hash: Hex; positionId: bigint }>;
  closePosition(positionId: bigint, params: CloseOptionPositionParams): Promise<Hex>;
  /// Settles every position in an expired series at the validated settlement price. European
  /// cash-settled options have no separate user "exercise" call — `OptionExercised` events are
  /// emitted per in-the-money position as part of this transaction.
  settle(underlying: string, expiry: bigint | Date | string, strike: Amount, type: OptionSide, tx?: TxOptions): Promise<Hex>;
}

export interface OptionsDeps {
  client: OrionisClient;
  addresses: ContractAddresses;
  decimals: (token: Address) => Promise<number>;
  markets: MarketsNamespace;
  fees: FeesNamespace;
  apiUrl?: string;
}

function optionTypeOf(type: OptionSide): OptionType {
  if (type !== "CALL" && type !== "PUT") throw new OrionisError(`Option type must be "CALL" or "PUT", received "${type}"`);
  return type === "CALL" ? OptionType.CALL : OptionType.PUT;
}

export function createOptions(deps: OptionsDeps): OptionsNamespace {
  const { client, addresses, decimals, markets, fees, apiUrl } = deps;

  function requireApi(method: string): string {
    if (!apiUrl) {
      throw new NotImplementedError(
        method,
        "requires `apiUrl` in the Orionis constructor config, pointing at services/api",
      );
    }
    return apiUrl;
  }

  async function getJson<T>(method: string, path: string): Promise<T> {
    const response = await fetch(`${requireApi(method)}${path}`);
    if (!response.ok) throw new OrionisError(`${method}: services/api returned ${response.status}`);
    return (await response.json()) as T;
  }

  async function expiries(underlying: string) {
    const rows = await getJson<string[]>("options.expiries", `/v1/options/${underlying}/expiries`);
    return rows.map((row) => BigInt(row));
  }

  async function chain(underlying: string, expiry?: bigint | Date | string) {
    const query = expiry === undefined ? "" : `?expiry=${toUnixSeconds(expiry)}`;
    const rows = await getJson<
      Array<{ series_id: Hex; expiry: string; strike: string; option_type: number }>
    >("options.chain", `/v1/options/${underlying}/chain${query}`);
    return rows.map((row) => ({
      seriesId: row.series_id,
      expiry: BigInt(row.expiry),
      strike: BigInt(row.strike),
      optionType: row.option_type as OptionType,
    }));
  }

  async function quote(params: OptionsQuoteParams): Promise<OptionsQuoteResult> {
    const base = requireApi("options.quote");
    const strike = toBaseUnits(params.strike, PRICE_DECIMALS);

    const response = await fetch(`${base}/v1/options/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        underlying: params.underlying,
        // services/pricing takes a plain decimal strike (PROJECT_BRIEF.md Section 10's example:
        // "strike": 190).
        strike: Number(fromBaseUnits(strike, PRICE_DECIMALS)),
        expiry: new Date(Number(toUnixSeconds(params.expiry)) * 1000).toISOString(),
        type: params.type,
        contracts: Number(toInteger(params.contracts, "contracts")),
      }),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new OrionisError(`options.quote: services/api returned ${response.status}: ${JSON.stringify(body)}`);
    }
    return body as OptionsQuoteResult;
  }

  async function contractSizeOf(marketId: Hex): Promise<bigint> {
    return client.readContract({
      address: addresses.optionMarket,
      abi: optionMarketAbi,
      functionName: "getContractSize",
      args: [marketId],
    });
  }

  async function previewOpen(params: OptionSeriesParams & { user?: Address }): Promise<OptionOpenPreview> {
    const marketId = resolveMarketId(params.underlying);
    const strike = toBaseUnits(params.strike, PRICE_DECIMALS);
    const expiry = toUnixSeconds(params.expiry);
    const contracts = toInteger(params.contracts, "contracts");
    const isCall = params.type === "CALL";
    const tokenDecimals = await decimals(addresses.settlementToken);

    const [quoted, contractSize, feeInfo] = await Promise.all([
      quote(params),
      contractSizeOf(marketId),
      fees.get(marketId),
    ]);

    // The quote is per underlying unit; fixed-point it at 18 decimals, then scale by contract
    // size and count before narrowing to token decimals.
    const premiumPerUnit = toBaseUnits(quoted.premium.toFixed(8), PRICE_DECIMALS);
    const premium = convertDecimals((premiumPerUnit * contractSize * contracts) / WAD, PRICE_DECIMALS, tokenDecimals);
    const fee = feeFromBps(premium, feeInfo.optionOpenFee);
    const totalRequired = premium + fee;

    const breakEven = isCall ? strike + premiumPerUnit : strike > premiumPerUnit ? strike - premiumPerUnit : 0n;
    const maxProfit = isCall
      ? null
      : convertDecimals(
          ((strike > premiumPerUnit ? strike - premiumPerUnit : 0n) * contractSize * contracts) / WAD,
          PRICE_DECIMALS,
          tokenDecimals,
        );

    // Same notional, in the same units, that OptionsEngine passes to RiskManager's size and
    // open-interest checks.
    const notional = ((contractSize * strike) / WAD) * contracts;
    const [violations, availableBalance] = await Promise.all([
      collectRiskViolations(client, addresses, markets, { marketId, isLong: isCall, notional, needs: "options" }),
      params.user
        ? client.readContract({
            address: addresses.vault,
            abi: vaultAbi,
            functionName: "availableBalance",
            args: [params.user, addresses.settlementToken],
          })
        : Promise.resolve(undefined),
    ]);

    return {
      marketId,
      type: params.type,
      strike,
      expiry,
      contracts,
      contractSize,
      quote: quoted,
      premium,
      fee,
      feeBps: feeInfo.optionOpenFee,
      totalRequired,
      breakEven,
      maxLoss: totalRequired,
      maxProfit,
      availableBalance,
      sufficientCollateral: availableBalance === undefined ? undefined : availableBalance >= totalRequired,
      violations,
    };
  }

  async function openPosition(params: OpenOptionPositionParams) {
    const tokenDecimals = await decimals(addresses.settlementToken);
    const premium = toBaseUnits(params.premium, tokenDecimals);
    const maxPremium =
      params.maxPremium === undefined
        ? applyBps(premium, BigInt(params.slippageBps ?? DEFAULT_PREMIUM_SLIPPAGE_BPS))
        : toBaseUnits(params.maxPremium, tokenDecimals);
    const args = {
      marketId: resolveMarketId(params.underlying),
      optionType: optionTypeOf(params.type),
      strike: toBaseUnits(params.strike, PRICE_DECIMALS),
      expiry: toUnixSeconds(params.expiry),
      contracts: toInteger(params.contracts, "contracts"),
      premium,
      maxPremium,
      deadline: params.deadline === undefined ? defaultDeadline() : toUnixSeconds(params.deadline),
    };

    const { hash, result } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "openPosition",
          args: [args],
        }),
      params.tx,
    );
    return { hash, positionId: result };
  }

  async function closePosition(positionId: bigint, params: CloseOptionPositionParams) {
    const tokenDecimals = await decimals(addresses.settlementToken);
    const premium = toBaseUnits(params.premium, tokenDecimals);
    const minPremium =
      params.minPremium === undefined
        ? applyBps(premium, -BigInt(params.slippageBps ?? DEFAULT_PREMIUM_SLIPPAGE_BPS))
        : toBaseUnits(params.minPremium, tokenDecimals);
    const deadline = params.deadline === undefined ? defaultDeadline() : toUnixSeconds(params.deadline);

    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "closePosition",
          args: [positionId, premium, minPremium, deadline],
        }),
      params.tx,
    );
    return hash;
  }

  async function settle(underlying: string, expiry: bigint | Date | string, strike: Amount, type: OptionSide, tx?: TxOptions) {
    const { hash } = await executeTx(
      client,
      () =>
        client.simulateContract({
          address: addresses.optionsEngine,
          abi: optionsEngineAbi,
          functionName: "settleExpired",
          args: [resolveMarketId(underlying), toUnixSeconds(expiry), toBaseUnits(strike, PRICE_DECIMALS), optionTypeOf(type)],
        }),
      tx,
    );
    return hash;
  }

  return { expiries, chain, quote, previewOpen, openPosition, closePosition, settle };
}
