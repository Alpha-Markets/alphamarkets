import { resolveMarketId, type AlphaMarkets } from "@alphamarkets/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";

/// Served from `services/indexer`'s materialized `markets` table (kept current from
/// `MarketAdded`/`MarketUpdated` events), not a live RPC call per request — MarketRegistry
/// on-chain remains the actual source of truth (PROJECT_BRIEF.md Section 18).
export function registerMarketRoutes(app: FastifyInstance, _alphamarkets: AlphaMarkets) {
  const sql = getSql();

  app.get("/v1/markets", async () => {
    return sql`select * from markets order by market_id`;
  });

  app.get<{ Params: { symbol: string } }>("/v1/markets/:symbol", async (request, reply) => {
    const marketId = resolveMarketId(request.params.symbol);
    const [market] = await sql`select * from markets where market_id = ${marketId}`;
    if (!market) return reply.code(404).send({ error: `no market found for ${request.params.symbol}` });
    return market;
  });
}
