import { resolveMarketId } from "@alphamarkets/sdk";
import type { FastifyInstance } from "fastify";
import { getSql } from "../db.js";
import {
  CANDLE_INTERVALS,
  DEFAULT_CANDLE_LIMIT,
  MAX_CANDLE_LIMIT,
  mergeCandles,
  OI_RANGES,
  openInterestSeries,
  parseInterval,
  parseLimit,
  parseOiRange,
  type OhlcRow,
  type SizeDelta,
  type VolumeRow,
} from "../analytics.js";

/// Analytics derived from what `services/indexer` recorded (events and index-price samples).
/// Display data only: nothing that decides money (margin, liquidation, settlement) reads it.
/// Like `routes/stats.ts`, event timestamps are the indexer's insert time, so they are accurate
/// while the indexer is at the chain head.
export function registerAnalyticsRoutes(app: FastifyInstance) {
  const sql = getSql();

  /// Every change in a perp position's size, one row per event, in event order: a position's
  /// notional after each event compared with the notional before it.
  const sizeChanges = sql`
    with pos_events as (
      select id, created_at, args ->> 'positionId' as pid,
        case event_name
          when 'PerpPositionOpened' then (args ->> 'size')::numeric
          when 'PerpPositionUpdated' then (args ->> 'newSize')::numeric
          else 0::numeric
        end as size_after
      from events
      where event_name in ('PerpPositionOpened', 'PerpPositionUpdated', 'PerpPositionClosed', 'PositionLiquidated')
    ), changes as (
      select id, created_at, pid,
        size_after - coalesce(lag(size_after) over (partition by pid order by id), 0) as delta
      from pos_events
    ), position_market as (
      select args ->> 'positionId' as pid, args ->> 'marketId' as market_id, (args ->> 'isLong')::boolean as is_long
      from events where event_name = 'PerpPositionOpened'
    )
    select c.id, c.created_at, c.delta, pm.market_id, pm.is_long
    from changes c join position_market pm on pm.pid = c.pid
  `;

  /// Candlesticks from the sampled index price, with the perp notional traded in each bucket as
  /// volume. A candle needs at least one price sample, so a quiet indexer leaves gaps.
  app.get<{ Params: { symbol: string }; Querystring: { interval?: string; limit?: string } }>(
    "/v1/prices/:symbol/candles",
    async (request) => {
      const marketId = resolveMarketId(request.params.symbol);
      const bucket = CANDLE_INTERVALS[parseInterval(request.query.interval)];
      const limit = parseLimit(request.query.limit, DEFAULT_CANDLE_LIMIT, MAX_CANDLE_LIMIT);
      const windowSeconds = bucket * limit;

      const [prices, volumes] = await Promise.all([
        sql<OhlcRow[]>`
          select extract(epoch from bucket)::bigint::int as time,
            (array_agg(price order by sampled_at asc))[1] as open,
            max(price::numeric)::text as high,
            min(price::numeric)::text as low,
            (array_agg(price order by sampled_at desc))[1] as close
          from (
            select price, sampled_at,
              date_bin(make_interval(secs => ${bucket}), sampled_at, timestamptz '2000-01-01') as bucket
            from price_ticks
            where market_id = ${marketId} and sampled_at >= now() - make_interval(secs => ${windowSeconds})
          ) t
          group by bucket
          order by bucket
        `,
        sql<VolumeRow[]>`
          with sc as (${sizeChanges})
          select extract(epoch from date_bin(make_interval(secs => ${bucket}), created_at, timestamptz '2000-01-01'))::bigint::int as time,
            sum(abs(delta))::text as volume
          from sc
          where market_id = ${marketId} and created_at >= now() - make_interval(secs => ${windowSeconds})
          group by 1
        `,
      ]);
      return mergeCandles(prices, volumes);
    },
  );

  /// Long and short open interest over time, rebuilt from the position events. It counts notional
  /// the same way `RiskManager` does (size opened, added, reduced, closed or liquidated).
  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>(
    "/v1/perps/:symbol/open-interest",
    async (request) => {
      const marketId = resolveMarketId(request.params.symbol);
      const { rangeSeconds, bucketSeconds } = OI_RANGES[parseOiRange(request.query.range)];
      const rows = await sql<{ time: string; delta: string; isLong: boolean }[]>`
        with sc as (${sizeChanges})
        select extract(epoch from created_at)::bigint::text as time, delta::text as delta, is_long
        from sc where market_id = ${marketId}
        order by id
      `;
      const deltas: SizeDelta[] = rows.map((row) => ({ time: Number(row.time), isLong: row.isLong, delta: BigInt(row.delta) }));
      const now = Math.floor(Date.now() / 1000);
      return openInterestSeries(deltas, bucketSeconds, now - rangeSeconds, now);
    },
  );

  /// The funding rate the chain applied at each interval, oldest first. The rate is
  /// `(mark - index) / index`, clamped; positive means longs paid shorts.
  app.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    "/v1/perps/:symbol/funding/history",
    async (request) => {
      const marketId = resolveMarketId(request.params.symbol);
      const limit = parseLimit(request.query.limit, 100, 500);
      const rows = await sql<{ time: string; rateBps: string; cumulativeIndex: string; txHash: string }[]>`
        select * from (
          select id, extract(epoch from created_at)::bigint::text as time,
            args ->> 'rateBps' as rate_bps, args ->> 'cumulativeIndex' as cumulative_index, tx_hash
          from events
          where event_name = 'FundingRateUpdated' and args ->> 'marketId' = ${marketId}
          order by id desc
          limit ${limit}
        ) latest
        order by id asc
      `;
      return rows.map((row) => ({ ...row, time: Number(row.time) }));
    },
  );

  /// Open interest and 24h volume per option series, in contracts. Open interest is the contracts
  /// opened and not closed, for series that have not expired yet; volume counts contracts opened
  /// and closed in the last 24 hours.
  app.get<{ Params: { symbol: string }; Querystring: { expiry?: string } }>(
    "/v1/options/:symbol/stats",
    async (request) => {
      const marketId = resolveMarketId(request.params.symbol);
      const expiry = request.query.expiry;
      if (expiry !== undefined && !/^\d+$/.test(expiry)) return [];
      return sql`
        with opened as (
          select args ->> 'positionId' as pid, args ->> 'expiry' as expiry, args ->> 'strike' as strike,
            (args ->> 'optionType')::int as option_type, (args ->> 'contracts')::numeric as contracts, created_at
          from events
          where event_name = 'OptionPositionOpened' and args ->> 'marketId' = ${marketId}
            ${expiry ? sql`and args ->> 'expiry' = ${expiry}` : sql``}
        ), closed as (
          select args ->> 'positionId' as pid, created_at from events where event_name = 'OptionPositionClosed'
        )
        select o.expiry, o.strike, o.option_type,
          coalesce(sum(o.contracts) filter (where c.pid is null and o.expiry::numeric > extract(epoch from now())), 0)::text as open_interest,
          (
            coalesce(sum(o.contracts) filter (where o.created_at >= now() - interval '24 hours'), 0)
            + coalesce(sum(o.contracts) filter (where c.created_at >= now() - interval '24 hours'), 0)
          )::text as volume_24h
        from opened o left join closed c on c.pid = o.pid
        group by o.expiry, o.strike, o.option_type
        order by o.expiry::numeric, o.strike::numeric, o.option_type
      `;
    },
  );

  /// Open limit orders for a wallet, from the indexed order events: placed, not cancelled or
  /// filled, not expired. The chain (`PerpOrderManager`) is the source of truth; this serves
  /// integrators that have no RPC access.
  app.get<{ Params: { wallet: string } }>("/v1/orders/:wallet", async (request) => {
    const wallet = request.params.wallet.toLowerCase();
    return sql`
      select p.args ->> 'orderId' as id, p.args ->> 'marketId' as market_id, (p.args ->> 'isLong')::boolean as is_long,
        p.args ->> 'collateral' as collateral, p.args ->> 'leverage' as leverage,
        p.args ->> 'triggerPrice' as trigger_price, p.args ->> 'expiry' as expiry,
        p.args ->> 'owner' as owner, 'OPEN' as status, '0' as position_id
      from events p
      where p.event_name = 'LimitOrderPlaced'
        and lower(p.args ->> 'owner') = ${wallet}
        and (p.args ->> 'expiry')::numeric > extract(epoch from now())
        and not exists (
          select 1 from events x
          where x.event_name in ('LimitOrderCancelled', 'LimitOrderExecuted') and x.args ->> 'orderId' = p.args ->> 'orderId'
        )
      order by p.id
    `;
  });

  /// Open stop-loss and take-profit orders for a wallet, from the indexed events: placed, not
  /// cancelled or fired, not expired, and whose position is still open (a position closed or
  /// liquidated some other way leaves its trigger orders behind onchain, where they can never
  /// fire). `kind` is 0 for a stop-loss and 1 for a take-profit. The chain (`PerpOrderManager`)
  /// is the source of truth.
  app.get<{ Params: { wallet: string } }>("/v1/trigger-orders/:wallet", async (request) => {
    const wallet = request.params.wallet.toLowerCase();
    return sql`
      select p.args ->> 'orderId' as id, p.args ->> 'positionId' as position_id, (p.args ->> 'kind')::int as kind,
        p.args ->> 'triggerPrice' as trigger_price, p.args ->> 'expiry' as expiry,
        p.args ->> 'owner' as owner, 'OPEN' as status
      from events p
      where p.event_name = 'TriggerOrderPlaced'
        and lower(p.args ->> 'owner') = ${wallet}
        and (p.args ->> 'expiry')::numeric > extract(epoch from now())
        and not exists (
          select 1 from events x
          where x.event_name in ('TriggerOrderCancelled', 'TriggerOrderExecuted') and x.args ->> 'orderId' = p.args ->> 'orderId'
        )
        and not exists (
          select 1 from events c
          where c.event_name in ('PerpPositionClosed', 'PositionLiquidated') and c.args ->> 'positionId' = p.args ->> 'positionId'
        )
      order by p.id
    `;
  });
}
