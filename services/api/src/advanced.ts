/// Pure helpers for `routes/advanced.ts` (funding analytics and institutional reporting), kept
/// free of I/O so they can be unit tested. Everything here is derived from indexed events: display
/// and reporting data, never an input to margin, liquidation or settlement.

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export interface FundingRate {
  /// Unix seconds.
  time: number;
  rateBps: number;
}

export interface FundingPayment {
  /// Token base units: positive was received by the position, negative was paid by it.
  amount: bigint;
  /// From the position's open event; `undefined` when unknown.
  isLong: boolean | undefined;
}

export interface FundingSummary {
  /// Rate updates in the window.
  intervals: number;
  latestRateBps: number | null;
  avgRateBps: number | null;
  minRateBps: number | null;
  maxRateBps: number | null;
  /// Sum of the rates applied in the window, in basis points of notional.
  cumulativeRateBps: number;
  /// Mean seconds between updates; the funding interval in practice.
  avgIntervalSeconds: number | null;
  /// The average rate repeated for a year at the observed interval. Not a forecast.
  annualizedRateBps: number | null;
  /// Share of updates with a positive rate (longs paying shorts), 0 to 1.
  positiveShare: number | null;
  /// Token base units, as decimal strings: what positions received and paid in the window.
  received: string;
  paid: string;
  longsNet: string;
  shortsNet: string;
}

/// Rate statistics and payment totals for one market over a window. `rates` may be in any order.
export function summarizeFunding(rates: FundingRate[], payments: FundingPayment[]): FundingSummary {
  const ordered = [...rates].sort((a, b) => a.time - b.time);
  const values = ordered.map((rate) => rate.rateBps);
  const sum = values.reduce((total, value) => total + value, 0);

  let avgIntervalSeconds: number | null = null;
  if (ordered.length >= 2) {
    avgIntervalSeconds = (ordered[ordered.length - 1]!.time - ordered[0]!.time) / (ordered.length - 1);
    if (!(avgIntervalSeconds > 0)) avgIntervalSeconds = null;
  }
  const avgRateBps = values.length === 0 ? null : sum / values.length;

  let received = 0n;
  let paid = 0n;
  let longsNet = 0n;
  let shortsNet = 0n;
  for (const payment of payments) {
    if (payment.amount >= 0n) received += payment.amount;
    else paid += -payment.amount;
    if (payment.isLong === true) longsNet += payment.amount;
    else if (payment.isLong === false) shortsNet += payment.amount;
  }

  return {
    intervals: values.length,
    latestRateBps: values.length === 0 ? null : values[values.length - 1]!,
    avgRateBps,
    minRateBps: values.length === 0 ? null : Math.min(...values),
    maxRateBps: values.length === 0 ? null : Math.max(...values),
    cumulativeRateBps: sum,
    avgIntervalSeconds,
    annualizedRateBps: avgRateBps !== null && avgIntervalSeconds !== null ? avgRateBps * (YEAR_SECONDS / avgIntervalSeconds) : null,
    positiveShare: values.length === 0 ? null : values.filter((value) => value > 0).length / values.length,
    received: received.toString(),
    paid: paid.toString(),
    longsNet: longsNet.toString(),
    shortsNet: shortsNet.toString(),
  };
}

export const FUNDING_RANGES = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000 } as const;
export type FundingRange = keyof typeof FUNDING_RANGES;

export function parseFundingRange(value: string | undefined): FundingRange {
  return value !== undefined && value in FUNDING_RANGES ? (value as FundingRange) : "7d";
}

// ---------------------------------------------------------------------------------------------
// Institutional reporting
// ---------------------------------------------------------------------------------------------

/// One indexed event as the report query returns it: `args` is the decoded event JSON, with
/// integers as strings.
export interface ReportEvent {
  id: number;
  txHash: string;
  eventName: string;
  createdAt: string | Date;
  args: Record<string, string | number | boolean | null>;
}

export type ReportRowType =
  | "deposit"
  | "withdrawal"
  | "perp_open"
  | "perp_update"
  | "perp_close"
  | "liquidation"
  | "option_open"
  | "option_close"
  | "option_settle"
  | "funding"
  | "fee"
  | "order_placed"
  | "order_cancelled"
  | "order_filled"
  | "rfq_fill"
  | "bad_debt"
  | "collateral_seized"
  | "trigger_placed"
  | "trigger_cancelled"
  | "trigger_fired";

export interface ReportRow {
  time: string;
  type: ReportRowType;
  txHash: string;
  positionId: string;
  marketId: string;
  /// Token base units, signed from the wallet's point of view: what it received is positive, what
  /// it paid or posted is negative. "0" where the event moves no money (an order, an update).
  amount: string;
  /// The event's own figures, as `name=value` pairs.
  detail: string;
}

const str = (value: string | number | boolean | null | undefined) => (value === null || value === undefined ? "" : String(value));

/// Reads an integer argument as a bigint; anything missing or malformed is 0.
function big(value: string | number | boolean | null | undefined): bigint {
  try {
    return typeof value === "boolean" || value === null || value === undefined || value === "" ? 0n : BigInt(value);
  } catch {
    return 0n;
  }
}

const detailOf = (args: ReportEvent["args"], keys: string[]) =>
  keys
    .filter((key) => args[key] !== undefined && args[key] !== null)
    .map((key) => `${key}=${str(args[key])}`)
    .join(" ");

/// Turns one event into a report row, or `undefined` for an event the report does not cover.
export function toReportRow(event: ReportEvent): ReportRow | undefined {
  const { args } = event;
  const time = event.createdAt instanceof Date ? event.createdAt.toISOString() : new Date(event.createdAt).toISOString();
  const base = { time, txHash: event.txHash, positionId: str(args.positionId), marketId: str(args.marketId) };
  const row = (type: ReportRowType, amount: bigint, detail: string): ReportRow => ({ ...base, type, amount: amount.toString(), detail });

  switch (event.eventName) {
    case "CollateralDeposited":
      return row("deposit", -big(args.amount), detailOf(args, ["token", "amount"]));
    case "CollateralWithdrawn":
      return row("withdrawal", big(args.amount), detailOf(args, ["token", "amount"]));
    case "PerpPositionOpened":
      return row("perp_open", 0n, detailOf(args, ["isLong", "size", "collateral", "leverage", "entryPrice"]));
    case "PerpPositionUpdated":
      return row("perp_update", big(args.realizedPnlDelta), detailOf(args, ["newSize", "newCollateral", "realizedPnlDelta"]));
    case "PerpPositionClosed":
      return row("perp_close", big(args.realizedPnl), detailOf(args, ["realizedPnl"]));
    case "PositionLiquidated":
      return row("liquidation", big(args.pnl) - big(args.fee), detailOf(args, ["markPriceAtLiquidation", "pnl", "fee"]));
    case "OptionPositionOpened":
      return row("option_open", -big(args.premium), detailOf(args, ["optionType", "strike", "expiry", "contracts", "premium"]));
    case "OptionPositionClosed":
      return row("option_close", big(args.realizedPnl), detailOf(args, ["realizedPnl"]));
    case "OptionExercised":
      return row("option_settle", big(args.payout), detailOf(args, ["intrinsicValue", "payout"]));
    case "FundingPaid":
      return row("funding", big(args.amount), detailOf(args, ["amount"]));
    case "ProtocolFeeCollected":
      return row("fee", -big(args.amount), detailOf(args, ["feeType", "amount"]));
    case "LimitOrderPlaced":
      return { ...base, type: "order_placed", amount: "0", detail: `orderId=${str(args.orderId)} ${detailOf(args, ["isLong", "collateral", "leverage", "triggerPrice", "expiry"])}` };
    case "LimitOrderCancelled":
      return { ...base, type: "order_cancelled", amount: "0", detail: `orderId=${str(args.orderId)}` };
    case "LimitOrderExecuted":
      return { ...base, positionId: str(args.positionId), type: "order_filled", amount: "0", detail: `orderId=${str(args.orderId)} ${detailOf(args, ["executionPrice"])}` };
    case "RFQExecuted":
      // The position opens at the quoted price; no money moves at that moment.
      return { ...base, positionId: str(args.positionId), type: "rfq_fill", amount: "0", detail: detailOf(args, ["maker", "price", "isBlock"]) };
    case "CollateralSeized":
      return row("collateral_seized", -big(args.valueCovered), detailOf(args, ["token", "amount", "valueCovered"]));
    case "BadDebt":
      return row("bad_debt", 0n, detailOf(args, ["amount"]));
    case "TriggerOrderPlaced":
      return { ...base, type: "trigger_placed", amount: "0", detail: `orderId=${str(args.orderId)} ${detailOf(args, ["kind", "triggerPrice", "expiry"])}` };
    case "TriggerOrderCancelled":
      return { ...base, type: "trigger_cancelled", amount: "0", detail: `orderId=${str(args.orderId)}` };
    case "TriggerOrderExecuted":
      return { ...base, type: "trigger_fired", amount: "0", detail: `orderId=${str(args.orderId)} ${detailOf(args, ["executionPrice"])}` };
    default:
      return undefined;
  }
}

export interface ReportTotals {
  deposited: string;
  withdrawn: string;
  /// Fees paid, as a positive number.
  fees: string;
  /// Funding received (positive) or paid (negative), net.
  funding: string;
  /// PnL realized on perp reductions and closes, before fees and funding.
  perpRealizedPnl: string;
  liquidationLoss: string;
  optionPremiumPaid: string;
  optionRealizedPnl: string;
  optionSettlementPayouts: string;
  /// Events of each type, for reconciling against the rows.
  counts: Record<string, number>;
}

export interface Report {
  from: string;
  to: string;
  rows: ReportRow[];
  totals: ReportTotals;
}

/// Rows and totals for the given events, oldest first. Amounts are in settlement-token base units.
export function buildReport(events: ReportEvent[], from: Date, to: Date): Report {
  const rows = events.flatMap((event) => {
    const row = toReportRow(event);
    return row ? [row] : [];
  });

  const sum = (type: ReportRowType) => rows.filter((row) => row.type === type).reduce((total, row) => total + BigInt(row.amount), 0n);
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.type] = (counts[row.type] ?? 0) + 1;

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    rows,
    totals: {
      deposited: (-sum("deposit")).toString(),
      withdrawn: sum("withdrawal").toString(),
      fees: (-sum("fee")).toString(),
      funding: sum("funding").toString(),
      perpRealizedPnl: (sum("perp_update") + sum("perp_close")).toString(),
      liquidationLoss: sum("liquidation").toString(),
      optionPremiumPaid: (-sum("option_open")).toString(),
      optionRealizedPnl: sum("option_close").toString(),
      optionSettlementPayouts: sum("option_settle").toString(),
      counts,
    },
  };
}

const CSV_COLUMNS = ["time", "type", "txHash", "positionId", "marketId", "amount", "detail"] as const;

/// A field is quoted when it holds a comma, a quote or a line break, or starts with a character a
/// spreadsheet would run as a formula (`=`, `+`, `-`, `@`): report values come from chain data, so
/// they are treated as untrusted when someone opens the file in a spreadsheet.
function csvField(value: string): string {
  const guarded = /^[=+\-@]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function reportToCsv(rows: ReportRow[]): string {
  const lines = [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((column) => csvField(row[column])).join(","))];
  return `${lines.join("\r\n")}\r\n`;
}

/// A date from an ISO string or unix seconds; `undefined` when it is neither.
export function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
