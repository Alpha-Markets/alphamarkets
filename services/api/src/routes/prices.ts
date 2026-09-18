import type { Orionis } from "@orionis/sdk";
import type { FastifyInstance } from "fastify";

/// PROJECT_BRIEF.md Section 17's three live price types (Settlement Price only exists once
/// an expiry has actually settled — read via the indexed `OptionSettled` event, not here).
export function registerPriceRoutes(app: FastifyInstance, orionis: Orionis) {
  app.get<{ Params: { symbol: string } }>("/v1/prices/:symbol", async (request) => {
    const marketId = request.params.symbol;
    const [index, mark, last] = await Promise.all([
      orionis.oracle.getIndexPrice(marketId),
      orionis.oracle.getMarkPrice(marketId),
      orionis.oracle.getLastPrice(marketId),
    ]);
    return {
      indexPrice: { price: index.price.toString(), timestamp: index.timestamp.toString() },
      markPrice: { price: mark.price.toString(), timestamp: mark.timestamp.toString() },
      lastPrice: { price: last.price.toString(), timestamp: last.timestamp.toString() },
    };
  });
}
