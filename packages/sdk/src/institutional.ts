import type { Address } from "@alphamarkets/types";
import { createApiGet } from "./api.js";
import { AlphaMarketsError } from "./errors.js";
import { toUnixSeconds } from "./utils.js";

/// Funding, reporting and risk endpoints for institutional users and bots (PROJECT_BRIEF.md
/// Sections 39 and 40). They read `services/api`, which reads the indexer and the chain. All of it
/// is display and reporting data: it never feeds margin, liquidation or settlement.

export type FundingRange = "24h" | "7d" | "30d";

export interface FundingAnalytics {
  marketId: string;
  range: FundingRange;
  /// Rate updates in the window.
  intervals: number;
  latestRateBps: number | null;
  avgRateBps: number | null;
  minRateBps: number | null;
  maxRateBps: number | null;
  cumulativeRateBps: number;
  avgIntervalSeconds: number | null;
  /// The average rate repeated for a year at the observed interval. Not a forecast.
  annualizedRateBps: number | null;
  /// Share of updates with a positive rate (longs paying shorts), 0 to 1.
  positiveShare: number | null;
  /// Settlement-token base units.
  received: bigint;
  paid: bigint;
  longsNet: bigint;
  shortsNet: bigint;
}

export interface ReportRow {
  time: string;
  type: string;
  txHash: string;
  positionId: string;
  marketId: string;
  /// Settlement-token base units, signed from the wallet's point of view.
  amount: bigint;
  detail: string;
}

export interface ReportTotals {
  deposited: bigint;
  withdrawn: bigint;
  fees: bigint;
  funding: bigint;
  perpRealizedPnl: bigint;
  liquidationLoss: bigint;
  optionPremiumPaid: bigint;
  optionRealizedPnl: bigint;
  optionSettlementPayouts: bigint;
  counts: Record<string, number>;
}

export interface WalletReport {
  wallet: Address;
  from: string;
  to: string;
  rows: ReportRow[];
  totals: ReportTotals;
  /// True when the range held more than the API's 5,000 row cap: narrow it for the rest.
  truncated: boolean;
}

export interface ReportRange {
  /// Unix seconds, `Date` or ISO string. Defaults to 30 days before `to`.
  from?: bigint | Date | string;
  /// Defaults to now.
  to?: bigint | Date | string;
}

export interface RiskScenario {
  shockBps: number;
  perpPnl: bigint;
  /// Ids of the perp positions that would be liquidated.
  liquidated: bigint[];
  optionValue: bigint;
  optionCost: bigint;
  optionPnl: bigint;
  /// Free collateral plus locked margin plus perp PnL, before options.
  equity: bigint;
  perps: Array<{ positionId: bigint; marketId: string; markPrice: bigint; pnl: bigint; marginRatioBps: bigint; liquidated: boolean }>;
}

export interface WalletRisk {
  wallet: Address;
  settlementDecimals: number;
  availableBalance: bigint;
  marks: Record<string, bigint>;
  /// Signed notional per market: longs positive, shorts negative.
  netPerpExposure: Record<string, bigint>;
  distances: Array<{ positionId: bigint; marketId: string; markPrice: bigint; liquidationPrice: bigint; distanceBps: bigint | null }>;
  scenarios: RiskScenario[];
  note: string;
}

export interface ProtocolExposure {
  marketId: string;
  active: boolean;
  long: bigint;
  short: bigint;
  total: bigint;
  net: bigint;
  cap: bigint;
  /// Share of the cap used, in basis points; `null` when there is no cap.
  usedBps: bigint | null;
}

export interface InstitutionalNamespace {
  /// Funding rate statistics and payment totals for one perp market. Requires `apiUrl`.
  fundingAnalytics(market: string, range?: FundingRange): Promise<FundingAnalytics>;
  /// A wallet's activity and totals between two dates. Requires `apiUrl`.
  report(user: Address, range?: ReportRange): Promise<WalletReport>;
  /// The same report as a CSV file's text. Requires `apiUrl`.
  reportCsv(user: Address, range?: ReportRange): Promise<string>;
  /// Stress test of a wallet's open positions: PnL, equity and liquidations for each price shock
  /// (basis points, default -30% to +30%), and the distance to liquidation now. Requires `apiUrl`.
  risk(user: Address, shocksBps?: number[]): Promise<WalletRisk>;
  /// Open interest, net skew and cap use per perp market. Requires `apiUrl`.
  protocolExposure(): Promise<ProtocolExposure[]>;
}

const big = (value: string) => BigInt(value);
const bigMap = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, big(value)]));

export function createInstitutional(apiUrl: string | undefined): InstitutionalNamespace {
  const apiGet = createApiGet(apiUrl);

  function reportQuery(range: ReportRange | undefined, extra?: string): string {
    const params = new URLSearchParams();
    if (range?.from !== undefined) params.set("from", toUnixSeconds(range.from).toString());
    if (range?.to !== undefined) params.set("to", toUnixSeconds(range.to).toString());
    if (extra) params.set("format", extra);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function fundingAnalytics(market: string, range: FundingRange = "7d") {
    const raw = await apiGet<Record<string, unknown>>("institutional.fundingAnalytics", `/v1/perps/${encodeURIComponent(market)}/funding/analytics?range=${range}`);
    return {
      ...raw,
      received: big(raw.received as string),
      paid: big(raw.paid as string),
      longsNet: big(raw.longsNet as string),
      shortsNet: big(raw.shortsNet as string),
    } as FundingAnalytics;
  }

  async function report(user: Address, range?: ReportRange): Promise<WalletReport> {
    const raw = await apiGet<{ wallet: Address; from: string; to: string; truncated: boolean; rows: Array<Omit<ReportRow, "amount"> & { amount: string }>; totals: Record<string, unknown> }>(
      "institutional.report",
      `/v1/reports/${user}${reportQuery(range)}`,
    );
    const { counts, ...amounts } = raw.totals as { counts: Record<string, number> } & Record<string, string>;
    return {
      wallet: raw.wallet,
      from: raw.from,
      to: raw.to,
      truncated: raw.truncated,
      rows: raw.rows.map((row) => ({ ...row, amount: big(row.amount) })),
      totals: { ...(Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, big(value)])) as Omit<ReportTotals, "counts">), counts },
    };
  }

  async function reportCsv(user: Address, range?: ReportRange): Promise<string> {
    if (!apiUrl) return apiGet<string>("institutional.reportCsv", "");
    const response = await fetch(`${apiUrl}/v1/reports/${user}${reportQuery(range, "csv")}`);
    if (!response.ok) throw new AlphaMarketsError(`institutional.reportCsv: services/api returned ${response.status}`);
    return response.text();
  }

  async function risk(user: Address, shocksBps?: number[]): Promise<WalletRisk> {
    if (shocksBps?.some((shock) => !Number.isInteger(shock))) throw new AlphaMarketsError("institutional.risk: shocks must be whole numbers of basis points");
    const query = shocksBps?.length ? `?shocks=${shocksBps.join(",")}` : "";
    const raw = await apiGet<Record<string, any>>("institutional.risk", `/v1/risk/${user}${query}`);
    return {
      wallet: raw.wallet,
      settlementDecimals: raw.settlementDecimals,
      availableBalance: big(raw.availableBalance),
      marks: bigMap(raw.marks),
      netPerpExposure: bigMap(raw.netPerpExposure),
      distances: raw.distances.map((row: any) => ({
        positionId: big(row.positionId),
        marketId: row.marketId,
        markPrice: big(row.markPrice),
        liquidationPrice: big(row.liquidationPrice),
        distanceBps: row.distanceBps === null ? null : big(row.distanceBps),
      })),
      scenarios: raw.scenarios.map((row: any) => ({
        shockBps: row.shockBps,
        perpPnl: big(row.perpPnl),
        liquidated: row.liquidated.map(big),
        optionValue: big(row.optionValue),
        optionCost: big(row.optionCost),
        optionPnl: big(row.optionPnl),
        equity: big(row.equity),
        perps: row.perps.map((perp: any) => ({
          positionId: big(perp.positionId),
          marketId: perp.marketId,
          markPrice: big(perp.markPrice),
          pnl: big(perp.pnl),
          marginRatioBps: big(perp.marginRatioBps),
          liquidated: perp.liquidated,
        })),
      })),
      note: raw.note,
    };
  }

  async function protocolExposure(): Promise<ProtocolExposure[]> {
    const rows = await apiGet<Array<Record<string, any>>>("institutional.protocolExposure", "/v1/risk/protocol/exposure");
    return rows.map((row) => ({
      marketId: row.marketId,
      active: row.active,
      long: big(row.long),
      short: big(row.short),
      total: big(row.total),
      net: big(row.net),
      cap: big(row.cap),
      usedBps: row.usedBps === null ? null : big(row.usedBps),
    }));
  }

  return { fundingAnalytics, report, reportCsv, risk, protocolExposure };
}
