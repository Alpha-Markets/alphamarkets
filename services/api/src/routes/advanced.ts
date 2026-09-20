import {
  DEFAULT_SHOCKS_BPS,
  liquidationDistances,
  netPerpExposure,
  OptionPositionStatus,
  OptionType,
  resolveMarketId,
  stressPortfolio,
  type Address,
  type Orionis,
  type StressInput,
} from "@orionis/sdk";
import type { FastifyInstance } from "fastify";
import { buildReport, FUNDING_RANGES, parseDate, parseFundingRange, reportToCsv, summarizeFunding, type ReportEvent } from "../advanced.js";
import { getSql } from "../db.js";
import { jsonSafe } from "../serialize.js";

type Sql = ReturnType<typeof getSql>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_REPORT_ROWS = 5_000;
const MAX_SHOCKS = 25;

/// A shock list from a comma-separated query value, each a whole number of basis points in
/// [-9999, 100000]. `undefined` for no value (use the default grid), `null` for a bad one.
export function parseShocks(value: string | undefined): number[] | undefined | null {
  if (value === undefined || value === "") return undefined;
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length > MAX_SHOCKS) return null;
  const shocks = parts.map((part) => (/^-?\d+$/.test(part) ? Number(part) : Number.NaN));
  return shocks.some((shock) => !Number.isInteger(shock) || shock < -9_999 || shock > 100_000) ? null : shocks;
}

/// Funding analytics, institutional reporting and the advanced risk API (PROJECT_BRIEF.md
/// Sections 39 and 40). The first two read the indexed events; the risk routes read the chain
/// through the SDK. All of it is display and reporting data: it never feeds margin, liquidation
/// or settlement, which stay onchain.
export function registerAdvancedRoutes(app: FastifyInstance, orionis: Orionis, sql: Sql = getSql()) {
  /// Rate statistics and payment totals for one perp market over a window (`range`: 24h, 7d
  /// default, 30d). `FundingRateUpdated` carries the rate; `FundingPaid` the money, whose side
  /// comes from the position's open event.
  app.get<{ Params: { symbol: string }; Querystring: { range?: string } }>("/v1/perps/:symbol/funding/analytics", async (request, reply) => {
    const range = parseFundingRange(request.query.range);
    const marketId = await resolveMarket(orionis, request.params.symbol);
    if (!marketId) return reply.code(404).send({ error: "unknown market" });

    const seconds = FUNDING_RANGES[range];
    const rates = await sql<Array<{ time: string; rateBps: string }>>`
      select extract(epoch from created_at)::bigint as time, args ->> 'rateBps' as rate_bps
      from events
      where event_name = 'FundingRateUpdated' and args ->> 'marketId' = ${marketId}
        and created_at >= now() - make_interval(secs => ${seconds})
      order by id asc
    `;
    const payments = await sql<Array<{ amount: string; isLong: boolean | null }>>`
      select f.args ->> 'amount' as amount, (o.args ->> 'isLong')::boolean as is_long
      from events f
      left join events o on o.event_name = 'PerpPositionOpened' and o.args ->> 'positionId' = f.args ->> 'positionId'
      where f.event_name = 'FundingPaid' and f.args ->> 'marketId' = ${marketId}
        and f.created_at >= now() - make_interval(secs => ${seconds})
    `;

    return {
      marketId,
      range,
      ...summarizeFunding(
        rates.map((row) => ({ time: Number(row.time), rateBps: Number(row.rateBps) })),
        payments.map((row) => ({ amount: BigInt(row.amount), isLong: row.isLong ?? undefined })),
      ),
    };
  });

  /// A wallet's activity between `from` and `to` (ISO date or unix seconds; default the last 30
  /// days), with totals. `format=csv` returns the rows as a spreadsheet file. Amounts are in
  /// settlement-token base units, signed from the wallet's point of view. Capped at 5,000 rows:
  /// narrow the range for more.
  app.get<{ Params: { wallet: string }; Querystring: { from?: string; to?: string; format?: string } }>("/v1/reports/:wallet", async (request, reply) => {
    const { wallet } = request.params;
    if (!ADDRESS.test(wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    const to = parseDate(request.query.to) ?? new Date();
    const from = parseDate(request.query.from) ?? new Date(to.getTime() - 30 * 86_400_000);
    if (request.query.from && !parseDate(request.query.from)) return reply.code(400).send({ error: "from must be an ISO date or unix seconds" });
    if (request.query.to && !parseDate(request.query.to)) return reply.code(400).send({ error: "to must be an ISO date or unix seconds" });
    if (from > to) return reply.code(400).send({ error: "from must not be after to" });
    if (request.query.format !== undefined && request.query.format !== "json" && request.query.format !== "csv") {
      return reply.code(400).send({ error: "format must be json or csv" });
    }

    const key = wallet.toLowerCase();
    // Events that name the wallet directly, plus the ones tied to it through a position id. Perp and
    // option position ids are separate counters, so each kind joins to its own open event.
    const rows = await sql<Array<{ id: number; txHash: string; eventName: string; createdAt: Date; args: ReportEvent["args"] }>>`
      select e.id, e.tx_hash, e.event_name, e.created_at, e.args
      from events e
      where e.created_at >= ${from} and e.created_at <= ${to}
        and (
          lower(e.args ->> 'user') = ${key} or lower(e.args ->> 'owner') = ${key} or lower(e.args ->> 'payer') = ${key}
          or (e.event_name in ('PerpPositionUpdated', 'PerpPositionClosed', 'FundingPaid') and exists (
            select 1 from events o where o.event_name = 'PerpPositionOpened'
              and o.args ->> 'positionId' = e.args ->> 'positionId' and lower(o.args ->> 'owner') = ${key}))
          or (e.event_name = 'OptionExercised' and exists (
            select 1 from events o where o.event_name = 'OptionPositionOpened'
              and o.args ->> 'positionId' = e.args ->> 'positionId' and lower(o.args ->> 'owner') = ${key}))
        )
      order by e.id asc
      limit ${MAX_REPORT_ROWS + 1}
    `;
    const truncated = rows.length > MAX_REPORT_ROWS;
    const report = buildReport(rows.slice(0, MAX_REPORT_ROWS), from, to);

    if (request.query.format === "csv") {
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="orionis-report-${key.slice(0, 10)}.csv"`)
        .send(reportToCsv(report.rows));
    }
    return { wallet, ...report, truncated };
  });

  /// Stress test of a wallet's open positions: PnL, equity and liquidations if every market moved
  /// by each shock (`shocks`: comma-separated basis points, default -30% to +30%), plus how far
  /// each perp position is from liquidation now. Options are valued at intrinsic value at the
  /// shocked price (no time value). Read from the chain.
  app.get<{ Params: { wallet: string }; Querystring: { shocks?: string } }>("/v1/risk/:wallet", async (request, reply) => {
    const { wallet } = request.params;
    if (!ADDRESS.test(wallet)) return reply.code(400).send({ error: "wallet must be an address" });
    const shocks = parseShocks(request.query.shocks);
    if (shocks === null) return reply.code(400).send({ error: `shocks must be up to ${MAX_SHOCKS} whole numbers of basis points between -9999 and 100000` });

    const [positions, available, decimals] = await Promise.all([
      orionis.portfolio.positions(wallet as Address),
      orionis.vault.availableBalance(wallet as Address, orionis.addresses.settlementToken),
      orionis.erc20.decimals(orionis.addresses.settlementToken),
    ]);
    const openPerps = positions.perps.filter((position) => position.open);
    const openOptions = positions.options.filter((position) => position.status === OptionPositionStatus.OPEN);

    const marketIds = [...new Set([...openPerps, ...openOptions].map((position) => position.marketId))];
    const marks: Record<string, bigint> = {};
    const maintenance: Record<string, bigint> = {};
    const contractSizes: Record<string, bigint> = {};
    await Promise.all(
      marketIds.map(async (marketId) => {
        marks[marketId] = (await orionis.oracle.getMarkPrice(marketId)).price;
        if (openPerps.some((position) => position.marketId === marketId)) maintenance[marketId] = (await orionis.risk.get(marketId)).maintenanceMarginRateBps;
        if (openOptions.some((position) => position.marketId === marketId)) contractSizes[marketId] = await orionis.options.contractSize(marketId);
      }),
    );

    const input: StressInput = {
      marks,
      settlementDecimals: decimals,
      availableBalance: available,
      perps: openPerps.map((position) => ({
        positionId: position.positionId,
        marketId: position.marketId,
        isLong: position.isLong,
        entryPrice: position.entryPrice,
        size: position.size,
        collateral: position.collateral,
        maintenanceMarginRateBps: maintenance[position.marketId] ?? 0n,
      })),
      options: openOptions.map((position) => ({
        positionId: position.positionId,
        marketId: position.marketId,
        type: position.optionType === OptionType.CALL ? "CALL" : "PUT",
        strike: position.strike,
        contracts: position.contracts,
        contractSize: contractSizes[position.marketId] ?? 0n,
        entryPremium: position.entryPremium,
      })),
    };

    return jsonSafe({
      wallet,
      settlementDecimals: decimals,
      availableBalance: available,
      marks,
      netPerpExposure: netPerpExposure(input.perps),
      distances: liquidationDistances(input),
      scenarios: stressPortfolio(input, shocks ?? DEFAULT_SHOCKS_BPS),
      note: "Options are valued at intrinsic value at the shocked price and ignore time value.",
    });
  });

  /// Protocol-wide exposure per perp market: open interest long and short, its net skew and the
  /// share of the cap used. Read from the chain.
  app.get("/v1/risk/protocol/exposure", async () => {
    const markets = (await orionis.markets.list()).filter((market) => market.perpsEnabled);
    const rows = await Promise.all(
      markets.map(async (market) => {
        const [interest, risk] = await Promise.all([orionis.risk.openInterest(market.marketId), orionis.risk.get(market.marketId)]);
        const cap = risk.openInterestCap;
        return {
          marketId: market.marketId,
          active: market.active,
          long: interest.long,
          short: interest.short,
          total: interest.total,
          net: interest.long - interest.short,
          cap,
          usedBps: cap === 0n ? null : (interest.total * 10_000n) / cap,
        };
      }),
    );
    return jsonSafe(rows);
  });
}

/// The market id for a symbol or bytes32 id, when the registry lists it.
async function resolveMarket(orionis: Orionis, symbol: string): Promise<string | undefined> {
  const marketId = resolveMarketId(symbol).toLowerCase();
  const markets = await orionis.markets.list();
  return markets.some((market) => market.marketId.toLowerCase() === marketId) ? marketId : undefined;
}
