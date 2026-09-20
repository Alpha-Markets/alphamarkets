import { resolveMarketId, type AlphaMarkets } from "@alphamarkets/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";

export function registerPerpRoutes(app: FastifyInstance, alphaMarkets: AlphaMarkets) {
  const sql = getSql();

  app.get("/v1/perps", async () => {
    return sql`select * from markets where perps_enabled = true order by market_id`;
  });

  app.get<{ Params: { symbol: string } }>("/v1/perps/:symbol", async (request, reply) => {
    const marketId = resolveMarketId(request.params.symbol);
    const [market] = await sql`select * from markets where market_id = ${marketId} and perps_enabled = true`;
    if (!market) return reply.code(404).send({ error: `no perp market found for ${request.params.symbol}` });
    return market;
  });

  app.get<{ Params: { symbol: string } }>("/v1/perps/:symbol/funding", async (request) => {
    const funding = await alphaMarkets.funding.get(request.params.symbol);
    return {
      currentFundingRateBps: funding.currentFundingRateBps.toString(),
      fundingIntervalSeconds: funding.fundingIntervalSeconds.toString(),
      nextFundingTimestamp: funding.nextFundingTimestamp.toString(),
    };
  });
}
