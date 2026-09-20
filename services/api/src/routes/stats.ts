import { resolveMarketId, type Address } from "@orionis/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";
import { changeBps, parseRange, RANGES } from "../stats.js";

/// Market statistics and history the chain cannot serve cheaply: everything here is derived from
/// what `services/indexer` recorded (events and index-price samples), so it is display data.
/// Anything that decides money — margin, liquidation, settlement — reads the chain, not this.
///
/// Timestamps are the indexer's row-insert time, not block time: accurate while the indexer is
/// at the chain head, and all equal to the backfill moment if it was replaying old blocks.
export function registerStatsRoutes(app: FastifyInstance) {
  const sql = getSql();

  /// Per market: 24h change of the index price, and 24h perp and options volume.
  ///
  /// Perp volume is the notional traded: new positions, plus the size change of every increase or
  /// reduction, plus the size closed or liquidated. Options volume is the premium paid on new
  /// positions (closing premiums are not on the open event). Both are in settlement-token base
  /// units. The size change comes from comparing each position's events in order, so positions
  /// opened before the 24h window still contribute their later changes.
  app.get("/v1/markets/stats", async () => {
    const [volumes, options, prices] = await Promise.all([
      sql<{ marketId: string; perpVolume24h: string }[]>`
        with pos_events as (
          select id, created_at, args ->> 'positionId' as pid,
            case event_name
              when 'PerpPositionOpened' then (args ->> 'size')::numeric
              when 'PerpPositionUpdated' then (args ->> 'newSize')::numeric
              else 0::numeric
            end as size_after
          from events
          where event_name in ('PerpPositionOpened', 'PerpPositionUpdated', 'PerpPositionClosed', 'PositionLiquidated')
        ), deltas as (
          select created_at, pid,
            abs(size_after - coalesce(lag(size_after) over (partition by pid order by id), 0)) as traded
          from pos_events
        ), market_of as (
          select args ->> 'positionId' as pid, args ->> 'marketId' as market_id
          from events where event_name = 'PerpPositionOpened'
        )
        select mo.market_id,
          coalesce(sum(d.traded) filter (where d.created_at >= now() - interval '24 hours'), 0)::text as perp_volume_24h
        from market_of mo join deltas d on d.pid = mo.pid
        group by mo.market_id
      `,
      sql<{ marketId: string; optionsVolume24h: string }[]>`
        select args ->> 'marketId' as market_id,
          coalesce(sum((args ->> 'premium')::numeric) filter (where created_at >= now() - interval '24 hours'), 0)::text as options_volume_24h
        from events where event_name = 'OptionPositionOpened'
        group by 1
      `,
      sql<{ marketId: string; latest: string | null; at24h: string | null; earliest: string | null; windowSeconds: string | null }[]>`
        select m.market_id,
          (select price from price_ticks p where p.market_id = m.market_id order by sampled_at desc limit 1) as latest,
          (select price from price_ticks p where p.market_id = m.market_id and p.sampled_at <= now() - interval '24 hours' order by sampled_at desc limit 1) as at_24h,
          (select price from price_ticks p where p.market_id = m.market_id order by sampled_at asc limit 1) as earliest,
          (select extract(epoch from (now() - min(sampled_at)))::bigint::text from price_ticks p where p.market_id = m.market_id) as window_seconds
        from markets m
      `,
    ]);

    // The DB client camel-cases column names (see `db.ts`), so `perp_volume_24h` reads as `perpVolume24h`.
    const perpVolume = new Map(volumes.map((row) => [row.marketId, row.perpVolume24h]));
    const optionsVolume = new Map(options.map((row) => [row.marketId, row.optionsVolume24h]));

    return prices.map((row) => {
      // Use the price from 24h ago when there is one; otherwise the earliest sample, and say how
      // short the window really is so the UI does not pass off a 20-minute move as a 24h one.
      const base = row.at24h ?? row.earliest;
      return {
        marketId: row.marketId,
        change24hBps: changeBps(row.latest, base),
        changeWindowSeconds: row.at24h ? 86_400 : row.windowSeconds ? Number(row.windowSeconds) : 0,
        perpVolume24h: perpVolume.get(row.marketId) ?? "0",
        optionsVolume24h: optionsVolume.get(row.marketId) ?? "0",
      };
    });
  });

  /// Index-price history for the terminal chart, thinned to one point per bucket.
  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>(
    "/v1/prices/:symbol/history",
    async (request) => {
      const { rangeSeconds, bucketSeconds } = RANGES[parseRange(request.query.range)];
      const marketId = resolveMarketId(request.params.symbol);
      const rows = await sql<{ time: string; price: string }[]>`
        select extract(epoch from bucket)::bigint::text as time, price from (
          select distinct on (bucket) bucket, price from (
            select price, sampled_at,
              date_bin(make_interval(secs => ${bucketSeconds}), sampled_at, timestamptz '2000-01-01') as bucket
            from price_ticks
            where market_id = ${marketId} and sampled_at >= now() - make_interval(secs => ${rangeSeconds})
          ) t
          order by bucket, sampled_at desc
        ) b
        order by bucket
      `;
      return rows.map((row) => ({ time: Number(row.time), price: row.price }));
    },
  );

  /// Funding a wallet's perp positions received (positive) or paid (negative). `FundingPaid`
  /// carries a position id, not an owner, so the owner comes from the position's open event.
  app.get<{ Params: { wallet: Address }; Querystring: { limit?: string; cursor?: string } }>(
    "/v1/funding/:wallet",
    async (request) => {
      const wallet = request.params.wallet.toLowerCase();
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const cursor = request.query.cursor ? Number(request.query.cursor) : 0;
      const rows = await sql`
        select f.id, f.tx_hash, f.block_number, f.created_at,
          f.args ->> 'positionId' as position_id, f.args ->> 'marketId' as market_id, f.args ->> 'amount' as amount
        from events f
        join events o on o.event_name = 'PerpPositionOpened'
          and o.args ->> 'positionId' = f.args ->> 'positionId'
          and lower(o.args ->> 'owner') = ${wallet}
        where f.event_name = 'FundingPaid' and f.id > ${cursor}
        order by f.id asc
        limit ${limit}
      `;
      return rows;
    },
  );
}
