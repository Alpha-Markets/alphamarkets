import type { Address, AlphaMarkets } from "@alphamarkets/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";
import { jsonSafe } from "../serialize.js";

export function registerPortfolioRoutes(app: FastifyInstance, alphaMarkets: AlphaMarkets) {
  const sql = getSql();
  const settlementToken = alphaMarkets.addresses.settlementToken;

  app.get<{ Params: { wallet: Address } }>("/v1/portfolio/:wallet", async (request) => {
    const { wallet } = request.params;
    const [balance, locked, available] = await Promise.all([
      alphaMarkets.vault.balanceOf(wallet, settlementToken),
      alphaMarkets.vault.lockedMargin(wallet, settlementToken),
      alphaMarkets.vault.availableBalance(wallet, settlementToken),
    ]);
    // MVP is single-collateral-asset only (PROJECT_BRIEF.md Section 7) — no aggregate
    // unrealized/realized PnL here; combine `/positions/:wallet` client-side for that.
    return jsonSafe({ settlementToken, balance, lockedMargin: locked, availableBalance: available });
  });

  app.get<{ Params: { wallet: Address } }>("/v1/positions/:wallet", async (request) => {
    const positions = await alphaMarkets.portfolio.positions(request.params.wallet);
    return jsonSafe(positions);
  });

  app.get<{ Params: { wallet: Address }; Querystring: { limit?: string; cursor?: string } }>(
    "/v1/history/:wallet",
    async (request) => {
      const wallet = request.params.wallet.toLowerCase();
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const cursor = request.query.cursor ? Number(request.query.cursor) : 0;

      // Checks every field that could hold a wallet address across the event types
      // `services/indexer` watches (`services/indexer/src/events.ts`) — a fixed, known set,
      // so each comparison is written out and parameterized rather than built dynamically.
      // `PerpPositionClosed` carries no wallet field, so it is matched through the wallet's own
      // `PerpPositionOpened` event for the same position id — that is how a close, and its realized
      // PnL, reaches the history of the account that owned the position.
      const rows = await sql`
        select id, tx_hash, log_index, block_number, contract_name, event_name, args, created_at
        from events
        where id > ${cursor}
          and (
            lower(args ->> 'user') = ${wallet}
            or lower(args ->> 'owner') = ${wallet}
            or lower(args ->> 'payer') = ${wallet}
            or lower(args ->> 'receiver') = ${wallet}
            or lower(args ->> 'liquidator') = ${wallet}
            or (
              event_name = 'PerpPositionClosed'
              and args ->> 'positionId' in (
                select args ->> 'positionId' from events
                where event_name = 'PerpPositionOpened' and lower(args ->> 'owner') = ${wallet}
              )
            )
          )
        order by id asc
        limit ${limit}
      `;
      return rows;
    },
  );
}
