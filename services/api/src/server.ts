import { requireEnv, resolveChainId } from "@alphamarkets/config";
import { AlphaMarkets } from "@alphamarkets/sdk";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { http } from "viem";
import { registerCors } from "./cors.js";
import { registerAdvancedRoutes } from "./routes/advanced.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerOptionRoutes } from "./routes/options.js";
import { registerPerpRoutes } from "./routes/perps.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerPriceRoutes } from "./routes/prices.js";
import { registerRfqRoutes } from "./routes/rfq.js";
import { httpUpstream, registerRpcProxy } from "./rpcProxy.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerTradeRoutes } from "./routes/trade.js";
import { registerWebSocket } from "./ws.js";

export function buildServer() {
  const chainId = resolveChainId(process.env.CHAIN_ID);
  const rpcUrl = requireEnv("RPC_URL");
  const alphaMarkets = new AlphaMarkets({ chainId, transport: http(rpcUrl) });

  const app = Fastify({ logger: true });

  registerCors(app);
  app.register(websocket);
  app.get("/health", async () => ({ ok: true }));

  app.register(async (instance) => {
    registerRpcProxy(instance, httpUpstream(rpcUrl));
    registerMarketRoutes(instance, alphaMarkets);
    registerOptionRoutes(instance, alphaMarkets);
    registerPerpRoutes(instance, alphaMarkets);
    registerPriceRoutes(instance, alphaMarkets);
    registerPortfolioRoutes(instance, alphaMarkets);
    registerStatsRoutes(instance);
    registerAnalyticsRoutes(instance);
    registerAdvancedRoutes(instance, alphaMarkets);
    registerTradeRoutes(instance, alphaMarkets);
    registerRfqRoutes(instance, alphaMarkets);
    registerWebSocket(instance, alphaMarkets);
  });

  return app;
}
