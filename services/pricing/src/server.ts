import { addressesForChain, requireEnv, ROBINHOOD_TESTNET_CHAIN_ID } from "@orionis/config";
import { Orionis } from "@orionis/sdk";
import Fastify from "fastify";
import { http } from "viem";
import { quote, type OptionType } from "./blackScholes.js";

const YEAR_SECONDS = 365 * 24 * 60 * 60;
const DEFAULT_IV = Number(process.env.DEFAULT_IV_BPS ?? 5000) / 10_000;
const RISK_FREE_RATE = Number(process.env.RISK_FREE_RATE_BPS ?? 0) / 10_000;

interface QuoteRequestBody {
  underlying: string;
  strike: number;
  expiry: string;
  type: OptionType;
  contracts: number;
}

export function buildServer() {
  const chainId = ROBINHOOD_TESTNET_CHAIN_ID;
  addressesForChain(chainId); // fail fast if this chain has no recorded deployment
  const orionis = new Orionis({ chainId, transport: http(requireEnv("RPC_URL")) });

  const app = Fastify({ logger: true });

  app.post<{ Body: QuoteRequestBody }>("/quote", async (request, reply) => {
    const { underlying, strike, expiry, type, contracts } = request.body;

    if (!underlying || !strike || !expiry || !type || !contracts) {
      return reply.code(400).send({ error: "underlying, strike, expiry, type, and contracts are all required" });
    }

    const expiryMs = Date.parse(expiry);
    if (Number.isNaN(expiryMs)) {
      return reply.code(400).send({ error: "expiry must be an ISO date string" });
    }

    const timeToExpiryYears = (expiryMs - Date.now()) / 1000 / YEAR_SECONDS;
    if (timeToExpiryYears <= 0) {
      return reply.code(400).send({ error: "expiry must be in the future" });
    }

    const { price: spotRaw } = await orionis.oracle.getIndexPrice(underlying);
    const spot = Number(spotRaw) / 1e18;

    // `strike` here is a plain decimal number (PROJECT_BRIEF.md Section 10's example:
    // "strike": 190) — a different unit than the 18-decimal-fixed-point `bigint` `strike`
    // `packages/sdk/src/options.ts`'s `openPosition` takes for the same market. A caller
    // that reuses that on-chain-scaled value here (e.g. 190e18) would get a nonsense
    // moneyness with no error; this range check catches that class of mistake rather than
    // silently returning a meaningless premium.
    if (strike / spot > 1000 || spot / strike > 1000) {
      return reply.code(400).send({
        error: `strike (${strike}) is implausibly far from spot (${spot}) — strike must be a plain decimal price, not an 18-decimal-scaled on-chain value`,
      });
    }

    // PROJECT_BRIEF.md Section 10's example returns per-contract premium/Greeks regardless
    // of the requested `contracts` count (10 contracts, premium 4.82, breakEven = strike +
    // that same 4.82) — `contracts` is accepted for parity with that request shape but does
    // not scale this response; a caller multiplies by it for a total position cost.
    const result = quote({
      spot,
      strike,
      timeToExpiryYears,
      volatility: DEFAULT_IV,
      riskFreeRate: RISK_FREE_RATE,
      optionType: type,
    });

    return { ...result, spot };
  });

  app.get("/health", async () => ({ ok: true }));

  return app;
}
