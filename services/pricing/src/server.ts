import { randomBytes } from "node:crypto";
import { requireEnv, resolveChainId } from "@alphamarkets/config";
import {
  closeQuoteTypedData,
  fromBaseUnits,
  openQuoteTypedData,
  AlphaMarkets,
  OptionPositionStatus,
  type Address,
  type Hex,
  OptionType as ChainOptionType,
  premiumForOrder,
  resolveMarketId,
  toBaseUnits,
} from "@alphamarkets/sdk";
import Fastify from "fastify";
import { http, isAddress, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { quote, type OptionType } from "./blackScholes.js";
import { advancedGreeks } from "./greeks.js";
import { buildSurface, surfaceVolatility, type SurfaceShape } from "./surface.js";
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
/// Shape of the volatility surface around the base volatility (see `surface.ts`). All 0 keeps the
/// surface flat: every strike and expiry prices with the same volatility. A placeholder until
/// product sets a skew, like the spread.
const SURFACE_SHAPE: SurfaceShape = {
  skewSlope: Number(process.env.VOL_SKEW_SLOPE ?? 0),
  smileCurve: Number(process.env.VOL_SMILE_CURVE ?? 0),
  termSlope: Number(process.env.VOL_TERM_SLOPE ?? 0),
};
const SURFACE_MAX_STRIKES = 25;
const SURFACE_MAX_EXPIRIES = 12;
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
  alphaMarkets?: AlphaMarkets;
  /// The `QUOTER_ROLE` signing account. Without it the service still returns analytics, but no
  /// authorization, so nothing can be opened or closed against its prices.
  account?: LocalAccount;
  now?: () => number;
  /// Index-price history for a market, for realized volatility. Injected in tests; otherwise read
  /// from `API_URL` (services/api) and empty when that is unset or unreachable.
  priceHistory?: (market: string) => Promise<PriceSample[]>;
  /// Overrides `OPTION_SPREAD_BPS`.
  spreadBps?: number;
  /// Overrides `VOL_SKEW_SLOPE`, `VOL_SMILE_CURVE` and `VOL_TERM_SLOPE`.
  surfaceShape?: SurfaceShape;
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
  const chainId = resolveChainId(process.env.CHAIN_ID);
  const alphaMarkets =
    options.alphaMarkets ?? new AlphaMarkets({ chainId, transport: http(requireEnv("RPC_URL")) });
  const account = options.account ?? quoterFromEnv();
  const now = options.now ?? Date.now;
  const spreadBps = options.spreadBps ?? SPREAD_BPS;
  const surfaceShape = options.surfaceShape ?? SURFACE_SHAPE;

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

  /// The model price and Greeks for one option, at the surface's volatility for that strike and
  /// expiry (the base volatility when the surface is flat), with the spread applied. The
  /// higher-order Greeks ride along for display.
  function priceOption(base: number, spot: number, strike: number, timeToExpiryYears: number, optionType: OptionType) {
    const volatility = surfaceVolatility(base, surfaceShape, { min: VOL_MIN, max: VOL_MAX }, spot, strike, timeToExpiryYears);
    const input = { spot, strike, timeToExpiryYears, volatility, riskFreeRate: RISK_FREE_RATE, optionType };
    return { ...applySpread(quote(input), spreadBps, strike, optionType), ...advancedGreeks(input) };
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
    const { price: spotRaw } = await alphaMarkets.oracle.getIndexPrice(underlying);
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
    const result = priceOption(volatility.value, spot, strikeNumber, timeToExpiryYears, type);

    let authorization;
    if (account && user) {
      const marketId = resolveMarketId(underlying);
      const [contractSize, tokenDecimals] = await Promise.all([
        alphaMarkets.options.contractSize(underlying),
        alphaMarkets.erc20.decimals(alphaMarkets.addresses.settlementToken),
      ]);
      // Opening pays the ask.
      const premium = premiumForOrder(result.ask, contractSize, BigInt(contracts), tokenDecimals);
      const validUntil = nowSeconds() + QUOTE_TTL_SECONDS;
      const nonce = randomNonce();
      const signature = await account.signTypedData(
        openQuoteTypedData({
          chainId,
          optionsEngine: alphaMarkets.addresses.optionsEngine,
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

    const position = await alphaMarkets.portfolio.getOptionPosition(BigInt(positionId));
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

    const { price: spotRaw } = await alphaMarkets.oracle.getIndexPrice(position.marketId);
    const spot = Number(spotRaw) / 1e18;
    const optionType = position.optionType === ChainOptionType.CALL ? "CALL" : "PUT";
    const strike = Number(fromBaseUnits(position.strike, 18));
    const volatility = await volatilityFor(position.marketId);
    const result = priceOption(volatility.value, spot, strike, timeToExpiryYears, optionType);

    const [contractSize, tokenDecimals] = await Promise.all([
      alphaMarkets.options.contractSize(position.marketId),
      alphaMarkets.erc20.decimals(alphaMarkets.addresses.settlementToken),
    ]);
    // Closing receives the bid.
    const premium = premiumForOrder(result.bid, contractSize, position.contracts, tokenDecimals);
    const validUntil = nowSeconds() + QUOTE_TTL_SECONDS;
    const nonce = randomNonce();
    const signature = await account.signTypedData(
      closeQuoteTypedData({
        chainId,
        optionsEngine: alphaMarkets.addresses.optionsEngine,
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

  /// The model's volatility surface for one underlying: implied-style volatility, prices and Greeks
  /// per strike and expiry, plus the at-the-money volatility and skew of each expiry. Display only.
  /// Query: `underlying`; optional `expiries` (comma-separated unix seconds, default 7, 14, 30, 60
  /// and 90 days out) and `strikes` (comma-separated decimals, default 80% to 120% of spot).
  app.get<{ Querystring: { underlying?: string; expiries?: string; strikes?: string } }>("/surface", async (request, reply) => {
    const { underlying, expiries, strikes } = request.query;
    if (!underlying) return reply.code(400).send({ error: "underlying is required" });

    const parseList = (text: string | undefined, name: string, max: number): number[] | undefined | { error: string } => {
      if (text === undefined || text === "") return undefined;
      const parts = text.split(",");
      const values = parts.map((part) => (/^\d+(\.\d+)?$/.test(part.trim()) ? Number(part) : Number.NaN));
      if (values.some((value) => !Number.isFinite(value) || value <= 0)) return { error: `${name} must be a comma-separated list of positive numbers` };
      if (values.length > max) return { error: `${name} takes at most ${max} values` };
      return values;
    };
    const expiryList = parseList(expiries, "expiries", SURFACE_MAX_EXPIRIES);
    const strikeList = parseList(strikes, "strikes", SURFACE_MAX_STRIKES);
    for (const parsed of [expiryList, strikeList]) {
      if (parsed && !Array.isArray(parsed)) return reply.code(400).send(parsed);
    }

    const { price: spotRaw } = await alphaMarkets.oracle.getIndexPrice(underlying);
    const spot = Number(spotRaw) / 1e18;
    const nowSecondsNumber = Math.floor(now() / 1000);
    const volatility = await volatilityFor(underlying);

    const surface = buildSurface({
      spot,
      strikes: (strikeList as number[] | undefined) ?? [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2].map((ratio) => Math.round(spot * ratio * 100) / 100),
      expiries: (expiryList as number[] | undefined) ?? [7, 14, 30, 60, 90].map((days) => nowSecondsNumber + days * 86_400),
      nowSeconds: nowSecondsNumber,
      baseVolatility: volatility.value,
      ivSource: volatility.source,
      shape: surfaceShape,
      bounds: { min: VOL_MIN, max: VOL_MAX },
      riskFreeRate: RISK_FREE_RATE,
    });
    return surface;
  });

  /// `quoter` and `optionsEngine` let an operator confirm this service signs as the address holding
  /// `QUOTER_ROLE` on the engine it is pointed at — a mismatch shows up as `InvalidQuote` onchain
  /// with no other hint. Both are public values.
  app.get("/health", async () => ({
    ok: true,
    signing: Boolean(account),
    quoter: account?.address,
    optionsEngine: alphaMarkets.addresses.optionsEngine,
  }));

  return app;
}
