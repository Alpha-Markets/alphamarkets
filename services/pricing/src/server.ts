import { randomBytes } from "node:crypto";
import { requireEnv, ROBINHOOD_TESTNET_CHAIN_ID } from "@orionis/config";
import {
  closeQuoteTypedData,
  fromBaseUnits,
  openQuoteTypedData,
  Orionis,
  OptionPositionStatus,
  type Address,
  type Hex,
  OptionType as ChainOptionType,
  premiumForOrder,
  resolveMarketId,
  toBaseUnits,
} from "@orionis/sdk";
import Fastify from "fastify";
import { http, isAddress, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quote, type OptionType } from "./blackScholes.js";
import { applySpread } from "./spread.js";
import { chooseVolatility, type PriceSample, type Volatility } from "./volatility.js";

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_IV = Number(process.env.DEFAULT_IV_BPS ?? 5000) / 10_000;
const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE_BPS ?? 0) / 10_000;
/// Full bid-ask spread as basis points of the mark, split evenly around it. Opening pays the ask and
/// closing receives the bid. 0 (the default) keeps both equal to the mark. A placeholder until
/// product sets one, like the fee schedule in `ConfigureMarkets.s.sol`.
const SPREAD_BPS = Number(process.env.OPTION_SPREAD_BPS ?? 0);
/// Realized volatility is measured from this much index-price history, served by services/api.
const VOL_HISTORY_RANGE = process.env.VOLATILITY_HISTORY_RANGE ?? "7d";
const VOL_MIN_SAMPLES = Number(process.env.VOLATILITY_MIN_SAMPLES ?? 24);
const VOL_MIN = Number(process.env.VOLATILITY_MIN_BPS ?? 1000) / 10_000;
const VOL_MAX = Number(process.env.VOLATILITY_MAX_BPS ?? 30_000) / 10_000;
const VOL_CACHE_MS = Number(process.env.VOLATILITY_CACHE_SECONDS ?? 300) * 1000;
/// A signed quote is a price the chain will honour, so it lives only briefly: a longer window is a
/// longer window for the spot price to move against the protocol.
const QUOTE_TTL_SECONDS = BigInt(process.env.QUOTE_TTL_SECONDS ?? 30);

interface QuoteRequestBody {
  underlying: string;
  /// A plain decimal price: a number (as in PROJECT_BRIEF.md Section 10) or an exact decimal string.
  strike: number | string;
  expiry: string;
  type: OptionType;
  contracts: number;
  /// When present and a signing key is configured, the response carries an `authorization` the
  /// chain will accept from this address only.
  user?: string;
}

interface CloseQuoteRequestBody {
  positionId: string;
  user: string;
}

export interface PricingOptions {
  /// Injected in tests; built from `RPC_URL` otherwise.
  orionis?: Orionis;
  /// The `QUOTER_ROLE` signing account. Without it the service still returns analytics, but no
  /// authorization, so nothing can be opened or closed against its prices.
  account?: LocalAccount;
  now?: () => number;
  /// Index-price history for a market, for realized volatility. Injected in tests; otherwise read
  /// from `API_URL` (services/api) and empty when that is unset or unreachable.
  priceHistory?: (market: string) => Promise<PriceSample[]>;
  /// Overrides `OPTION_SPREAD_BPS`.
  spreadBps?: number;
}

/// Reads the indexer's index-price history through services/api's public endpoint, so this service
/// never touches the indexer's database. Any failure means "no history": the caller then prices
/// with the flat default volatility instead of failing the quote.
function apiPriceHistory(): (market: string) => Promise<PriceSample[]> {
  const apiUrl = process.env.API_URL;
  return async (market) => {
    if (!apiUrl) return [];
    try {
      const response = await fetch(`${apiUrl}/v1/prices/${market}/history?range=${VOL_HISTORY_RANGE}`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!response.ok) return [];
      const rows = (await response.json()) as Array<{ time: number; price: string }>;
      return rows.map((row) => ({ time: row.time, price: Number(row.price) / 1e18 }));
    } catch {
      return [];
    }
  };
}

function quoterFromEnv(): LocalAccount | undefined {
  const key = process.env.QUOTER_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex) : undefined;
}

/// A fresh single-use identifier. The contract also rejects a repeated digest, so this only has to
/// make two quotes for identical orders differ.
function randomNonce(): bigint {
  return BigInt(`0x${randomBytes(16).toString("hex")}`);
}

export function buildServer(options: PricingOptions = {}) {
  const chainId = ROBINHOOD_TESTNET_CHAIN_ID;
  const orionis =
    options.orionis ?? new Orionis({ chainId, transport: http(requireEnv("RPC_URL")) });
  const account = options.account ?? quoterFromEnv();
  const now = options.now ?? Date.now;
  const spreadBps = options.spreadBps ?? SPREAD_BPS;

  const app = Fastify({ logger: true });

  const nowSeconds = () => BigInt(Math.floor(now() / 1000));

  const loadHistory = options.priceHistory ?? apiPriceHistory();
  const volatilityCache = new Map<string, { at: number; value: Volatility }>();
  /// Realized volatility for a market, cached briefly: every chain row asks for a quote, and the
  /// history barely changes within minutes.
  async function volatilityFor(market: string): Promise<Volatility> {
    const cached = volatilityCache.get(market);
    if (cached && now() - cached.at < VOL_CACHE_MS) return cached.value;
    const value = chooseVolatility(await loadHistory(market), DEFAULT_IV, {
      minSamples: VOL_MIN_SAMPLES,
      min: VOL_MIN,
      max: VOL_MAX,
    });
    volatilityCache.set(market, { at: now(), value });
    return value;
  }

  app.post<{ Body: QuoteRequestBody }>("/quote", async (request, reply) => {
    const { underlying, strike, expiry, type, contracts, user } = request.body;

    if (!underlying || !strike || !expiry || !type || !contracts) {
      return reply.code(400).send({ error: "underlying, strike, expiry, type, and contracts are all required" });
    }
    if (user !== undefined && !isAddress(user)) {
      return reply.code(400).send({ error: "user must be an address" });
    }

    const expiryMs = Date.parse(expiry);
    if (Number.isNaN(expiryMs)) {
      return reply.code(400).send({ error: "expiry must be an ISO date string" });
    }

    const timeToExpiryYears = (expiryMs - now()) / 1000 / YEAR_SECONDS;
    if (timeToExpiryYears <= 0) {
      return reply.code(400).send({ error: "expiry must be in the future" });
    }

    const strikeNumber = Number(strike);
    const { price: spotRaw } = await orionis.oracle.getIndexPrice(underlying);
    const spot = Number(spotRaw) / 1e18;

    // `strike` here is a plain decimal (PROJECT_BRIEF.md Section 10's example: "strike": 190) — a
    // different unit than the 18-decimal-fixed-point `bigint` strike the contracts take. A caller
    // that reuses that on-chain-scaled value here (e.g. 190e18) would get a nonsense moneyness with
    // no error; this range check catches that class of mistake rather than silently returning a
    // meaningless premium.
    if (strikeNumber / spot > 1000 || spot / strikeNumber > 1000) {
      return reply.code(400).send({
        error: `strike (${strike}) is implausibly far from spot (${spot}) — strike must be a plain decimal price, not an 18-decimal-scaled on-chain value`,
      });
    }

    // PROJECT_BRIEF.md Section 10's example returns per-contract premium/Greeks regardless of the
    // requested `contracts` count, so `contracts` does not scale the analytics below; a caller
    // multiplies by it for a total position cost. The signed authorization, by contrast, is for
    // the whole order.
    const volatility = await volatilityFor(underlying);
    const result = applySpread(
      quote({
        spot,
        strike: strikeNumber,
        timeToExpiryYears,
        volatility: volatility.value,
        riskFreeRate: RISK_FREE_RATE,
        optionType: type,
      }),
      spreadBps,
      strikeNumber,
      type,
    );

    let authorization;
    if (account && user) {
      const marketId = resolveMarketId(underlying);
      const [contractSize, tokenDecimals] = await Promise.all([
        orionis.options.contractSize(underlying),
        orionis.erc20.decimals(orionis.addresses.settlementToken),
      ]);
      // Opening pays the ask.
      const premium = premiumForOrder(result.ask, contractSize, BigInt(contracts), tokenDecimals);
      const validUntil = nowSeconds() + QUOTE_TTL_SECONDS;
      const nonce = randomNonce();
      const signature = await account.signTypedData(
        openQuoteTypedData({
          chainId,
          optionsEngine: orionis.addresses.optionsEngine,
          user: user as Address,
          marketId,
          optionType: type === "CALL" ? ChainOptionType.CALL : ChainOptionType.PUT,
          // Exact when the caller sent a string; a number is fixed to 8 places like the premium.
          strike: toBaseUnits(typeof strike === "string" ? strike : strike.toFixed(8), 18),
          expiry: BigInt(Math.floor(expiryMs / 1000)),
          contracts: BigInt(contracts),
          premium,
          validUntil,
          nonce,
        }),
      );
      authorization = {
        premium: premium.toString(),
        validUntil: validUntil.toString(),
        nonce: nonce.toString(),
        signature,
      };
    }

    return { ...result, spot, ivSource: volatility.source, ...(authorization ? { authorization } : {}) };
  });

  /// Prices closing an open position at the current spot and signs it for the position's owner.
  app.post<{ Body: CloseQuoteRequestBody }>("/quote/close", async (request, reply) => {
    if (!account) {
      return reply.code(503).send({ error: "this pricing service has no quoter key configured, so it cannot sign quotes" });
    }
    const { positionId, user } = request.body;
    if (!positionId || !/^\d+$/.test(positionId) || !user || !isAddress(user)) {
      return reply.code(400).send({ error: "positionId (integer string) and user (address) are required" });
    }

    const position = await orionis.portfolio.getOptionPosition(BigInt(positionId));
    if (position.owner.toLowerCase() !== user.toLowerCase()) {
      return reply.code(403).send({ error: "position belongs to a different address" });
    }
    if (position.status !== OptionPositionStatus.OPEN) {
      return reply.code(409).send({ error: "position is not open" });
    }
    const timeToExpiryYears = (Number(position.expiry) - Number(nowSeconds())) / YEAR_SECONDS;
    if (timeToExpiryYears <= 0) {
      return reply.code(409).send({ error: "position has expired; settle it instead of closing" });
    }

    const { price: spotRaw } = await orionis.oracle.getIndexPrice(position.marketId);
    const spot = Number(spotRaw) / 1e18;
    const optionType = position.optionType === ChainOptionType.CALL ? "CALL" : "PUT";
    const strike = Number(fromBaseUnits(position.strike, 18));
    const volatility = await volatilityFor(position.marketId);
    const result = applySpread(
      quote({ spot, strike, timeToExpiryYears, volatility: volatility.value, riskFreeRate: RISK_FREE_RATE, optionType }),
      spreadBps,
      strike,
      optionType,
    );

    const [contractSize, tokenDecimals] = await Promise.all([
      orionis.options.contractSize(position.marketId),
      orionis.erc20.decimals(orionis.addresses.settlementToken),
    ]);
    // Closing receives the bid.
    const premium = premiumForOrder(result.bid, contractSize, position.contracts, tokenDecimals);
    const validUntil = nowSeconds() + QUOTE_TTL_SECONDS;
    const nonce = randomNonce();
    const signature = await account.signTypedData(
      closeQuoteTypedData({
        chainId,
        optionsEngine: orionis.addresses.optionsEngine,
        user: user as Address,
        positionId: BigInt(positionId),
        premium,
        validUntil,
        nonce,
      }),
    );

    return {
      ...result,
      spot,
      ivSource: volatility.source,
      authorization: {
        premium: premium.toString(),
        validUntil: validUntil.toString(),
        nonce: nonce.toString(),
        signature,
      },
    };
  });

  /// `quoter` and `optionsEngine` let an operator confirm this service signs as the address holding
  /// `QUOTER_ROLE` on the engine it is pointed at — a mismatch shows up as `InvalidQuote` onchain
  /// with no other hint. Both are public values.
  app.get("/health", async () => ({
    ok: true,
    signing: Boolean(account),
    quoter: account?.address,
    optionsEngine: orionis.addresses.optionsEngine,
  }));

  return app;
}
