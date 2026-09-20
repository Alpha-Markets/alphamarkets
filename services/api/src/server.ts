import { requireEnv, ROBINHOOD_TESTNET_CHAIN_ID } from "@orionis/config";
import { Orionis } from "@orionis/sdk";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { http } from "viem";
import { registerCors } from "./cors.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerOptionRoutes } from "./routes/options.js";
import { registerPerpRoutes } from "./routes/perps.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerPriceRoutes } from "./routes/prices.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerWebSocket } from "./ws.js";

export function buildServer() {
  const chainId = ROBINHOOD_TESTNET_CHAIN_ID;
  const orionis = new Orionis({ chainId, transport: http(requireEnv("RPC_URL")) });

  const app = Fastify({ logger: true });

  registerCors(app);
  app.register(websocket);
  app.get("/health", async () => ({ ok: true }));

  app.register(async (instance) => {
    registerMarketRoutes(instance, orionis);
    registerOptionRoutes(instance, orionis);
    registerPerpRoutes(instance, orionis);
    registerPriceRoutes(instance, orionis);
    registerPortfolioRoutes(instance, orionis);
    registerStatsRoutes(instance);
    registerAnalyticsRoutes(instance);
    registerWebSocket(instance, orionis);
  });

  return app;
}
