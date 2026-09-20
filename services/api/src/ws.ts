import type { Orionis } from "@orionis/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "./db.js";

/// Broadcasts live index price + funding rate per active market on an interval
/// (PROJECT_BRIEF.md Section 33's "WebSocket feed for live market data"). Poll-based, not
/// push-based off indexed events: a Postgres LISTEN/NOTIFY relay from `services/indexer`
/// would forward new events in real time instead of on a fixed tick, but that's not wired
/// up here — this only covers "price, funding", not the "order book/chain updates" half of
/// Section 33's description (there's no order book in this contract design to update).
const TICK_MS = Number(process.env.WS_TICK_MS ?? 5000);

interface Sendable {
  send(data: string): void;
}

export function registerWebSocket(app: FastifyInstance, orionis: Orionis) {
  const sql = getSql();
  const clients = new Set<Sendable>();

  app.get("/v1/ws", { websocket: true }, (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
  });

  async function broadcastTick() {
    if (clients.size === 0) return;

    const markets = await sql<{ marketId: string }[]>`
      select market_id as "marketId" from markets where active = true
    `;

    for (const { marketId } of markets) {
      let payload: string;
      try {
        const [index, funding] = await Promise.all([
          orionis.oracle.getIndexPrice(marketId),
          orionis.funding.get(marketId),
        ]);
        payload = JSON.stringify({
          type: "tick",
          marketId,
          indexPrice: index.price.toString(),
          timestamp: index.timestamp.toString(),
          fundingRateBps: funding.currentFundingRateBps.toString(),
        });
      } catch (error) {
        app.log.warn({ error, marketId }, "ws: failed to fetch tick data for market");
        continue;
      }

      // Isolated per client: one stale/closing socket throwing on send() must not stop
      // delivery to every other client still connected for this market's tick.
      for (const client of clients) {
        try {
          client.send(payload);
        } catch (error) {
          app.log.warn({ error, marketId }, "ws: failed to send tick to a client");
        }
      }
    }
  }

  const timer = setInterval(() => void broadcastTick(), TICK_MS);
  // Stop ticking when the server closes, so `app.close()` lets the process (or a test) exit.
  app.addHook("onClose", async () => clearInterval(timer));
}
