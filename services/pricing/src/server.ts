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

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_IV = Number(process.env.DEFAULT_IV_BPS ?? 5000) / 10_000;
const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE_BPS ?? 0) / 10_000;
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

  const app = Fastify({ logger: true });

  const nowSeconds = () => BigInt(Math.floor(now() / 1000));

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
    const result = quote({
      spot,
      strike: strikeNumber,
      timeToExpiryYears,
      volatility: DEFAULT_IV,
      riskFreeRate: RISK_FREE_RATE,
      optionType: type,
    });

    let authorization;
    if (account && user) {
      const marketId = resolveMarketId(underlying);
      const [contractSize, tokenDecimals] = await Promise.all([
        orionis.options.contractSize(underlying),
        orionis.erc20.decimals(orionis.addresses.settlementToken),
      ]);
      const premium = premiumForOrder(result.premium, contractSize, BigInt(contracts), tokenDecimals);
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

    return { ...result, spot, ...(authorization ? { authorization } : {}) };
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
    const result = quote({
      spot,
      strike: Number(fromBaseUnits(position.strike, 18)),
      timeToExpiryYears,
      volatility: DEFAULT_IV,
      riskFreeRate: RISK_FREE_RATE,
      optionType: position.optionType === ChainOptionType.CALL ? "CALL" : "PUT",
    });

    const [contractSize, tokenDecimals] = await Promise.all([
      orionis.options.contractSize(position.marketId),
      orionis.erc20.decimals(orionis.addresses.settlementToken),
    ]);
    const premium = premiumForOrder(result.premium, contractSize, position.contracts, tokenDecimals);
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
