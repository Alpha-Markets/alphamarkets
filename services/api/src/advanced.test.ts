import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, parseDate, parseFundingRange, reportToCsv, summarizeFunding, toReportRow, type ReportEvent } from "./advanced.js";

const YEAR = 365 * 24 * 60 * 60;

test("funding statistics over a window: average, extremes, interval and annualized rate", () => {
  const summary = summarizeFunding(
    [
      { time: 7_200, rateBps: 4 },
      { time: 0, rateBps: 2 },
      { time: 3_600, rateBps: -1 },
    ],
    [],
  );
  assert.equal(summary.intervals, 3);
  assert.equal(summary.latestRateBps, 4, "latest by time, not by input order");
  assert.equal(summary.avgRateBps, 5 / 3);
  assert.equal(summary.minRateBps, -1);
  assert.equal(summary.maxRateBps, 4);
  assert.equal(summary.cumulativeRateBps, 5);
  assert.equal(summary.avgIntervalSeconds, 3_600);
  assert.equal(summary.annualizedRateBps, (5 / 3) * (YEAR / 3_600));
  assert.equal(summary.positiveShare, 2 / 3);
});

test("no rates gives nulls, one rate has no interval to annualize", () => {
  const none = summarizeFunding([], []);
  assert.equal(none.intervals, 0);
  assert.equal(none.avgRateBps, null);
  assert.equal(none.annualizedRateBps, null);
  assert.equal(none.positiveShare, null);
  const one = summarizeFunding([{ time: 5, rateBps: 3 }], []);
  assert.equal(one.avgIntervalSeconds, null);
  assert.equal(one.annualizedRateBps, null);
  assert.equal(one.latestRateBps, 3);
});

test("payments split into received and paid, and by side", () => {
  const summary = summarizeFunding(
    [],
    [
      { amount: 5n, isLong: false },
      { amount: -3n, isLong: true },
      { amount: -2n, isLong: true },
      { amount: 1n, isLong: undefined },
    ],
  );
  assert.equal(summary.received, "6");
  assert.equal(summary.paid, "5");
  assert.equal(summary.longsNet, "-5");
  assert.equal(summary.shortsNet, "5");
});

test("funding ranges default to 7d", () => {
  assert.equal(parseFundingRange("24h"), "24h");
  assert.equal(parseFundingRange("30d"), "30d");
  assert.equal(parseFundingRange("1y"), "7d");
  assert.equal(parseFundingRange(undefined), "7d");
});

const at = "2026-09-20T12:00:00.000Z";
const event = (id: number, eventName: string, args: ReportEvent["args"]): ReportEvent => ({ id, txHash: `0x${id}`, eventName, createdAt: at, args });

test("each event maps to a signed row: what the wallet receives is positive", () => {
  const deposit = toReportRow(event(1, "CollateralDeposited", { user: "0xa", token: "0xt", amount: "1000" }))!;
  assert.equal(deposit.type, "deposit");
  assert.equal(deposit.amount, "-1000");
  assert.equal(toReportRow(event(2, "CollateralWithdrawn", { amount: "400" }))!.amount, "400");
  assert.equal(toReportRow(event(3, "ProtocolFeeCollected", { amount: "7", feeType: "TAKER" }))!.amount, "-7");
  assert.equal(toReportRow(event(4, "FundingPaid", { positionId: "1", amount: "-3" }))!.amount, "-3");
  assert.equal(toReportRow(event(5, "OptionPositionOpened", { positionId: "9", premium: "50" }))!.amount, "-50");
  assert.equal(toReportRow(event(6, "PositionLiquidated", { positionId: "1", pnl: "-100", fee: "5" }))!.amount, "-105");
  assert.equal(toReportRow(event(7, "OptionExercised", { positionId: "9", payout: "80" }))!.amount, "80");
});

test("orders and triggers are listed with no money moved; unknown events are skipped", () => {
  const placed = toReportRow(event(1, "TriggerOrderPlaced", { orderId: "3", positionId: "2", kind: "0", triggerPrice: "180" }))!;
  assert.equal(placed.type, "trigger_placed");
  assert.equal(placed.amount, "0");
  assert.match(placed.detail, /orderId=3 .*triggerPrice=180/);
  assert.equal(toReportRow(event(2, "LimitOrderExecuted", { orderId: "1", positionId: "5", executionPrice: "1" }))!.positionId, "5");
  assert.equal(toReportRow(event(3, "MarketUpdated", {})), undefined);
});

test("RFQ fills, seized collateral and bad debt are reported", () => {
  const fill = toReportRow(event(1, "RFQExecuted", { user: "0xa", maker: "0xm", positionId: "4", price: "190", isBlock: true }))!;
  assert.equal(fill.type, "rfq_fill");
  assert.equal(fill.positionId, "4");
  assert.match(fill.detail, /price=190 isBlock=true/);
  assert.equal(toReportRow(event(2, "CollateralSeized", { owner: "0xa", token: "0xt", amount: "5", valueCovered: "40" }))!.amount, "-40");
  assert.equal(toReportRow(event(3, "BadDebt", { positionId: "1", owner: "0xa", amount: "9" }))!.type, "bad_debt");
});

test("a malformed number is 0 rather than a crash", () => {
  assert.equal(toReportRow(event(1, "CollateralDeposited", { amount: "abc" }))!.amount, "0");
  assert.equal(toReportRow(event(2, "CollateralDeposited", {}))!.amount, "0");
});

test("totals add up from the rows and counts reconcile", () => {
  const report = buildReport(
    [
      event(1, "CollateralDeposited", { amount: "1000" }),
      event(2, "PerpPositionOpened", { positionId: "1", marketId: "0xm", isLong: true }),
      event(3, "ProtocolFeeCollected", { amount: "5", feeType: "TAKER" }),
      event(4, "PerpPositionUpdated", { positionId: "1", realizedPnlDelta: "20" }),
      event(5, "PerpPositionClosed", { positionId: "1", realizedPnl: "-8" }),
      event(6, "FundingPaid", { positionId: "1", amount: "-2" }),
      event(7, "OptionPositionOpened", { positionId: "4", premium: "30" }),
      event(8, "OptionPositionClosed", { positionId: "4", realizedPnl: "10" }),
      event(9, "CollateralWithdrawn", { amount: "300" }),
      event(10, "SomethingElse", {}),
    ],
    new Date("2026-09-01T00:00:00Z"),
    new Date("2026-09-30T00:00:00Z"),
  );
  assert.equal(report.rows.length, 9);
  assert.deepEqual(
    { ...report.totals, counts: undefined },
    {
      deposited: "1000",
      withdrawn: "300",
      fees: "5",
      funding: "-2",
      perpRealizedPnl: "12",
      liquidationLoss: "0",
      optionPremiumPaid: "30",
      optionRealizedPnl: "10",
      optionSettlementPayouts: "0",
      counts: undefined,
    },
  );
  assert.equal(report.totals.counts.perp_close, 1);
  assert.equal(report.from, "2026-09-01T00:00:00.000Z");
});

test("CSV has a header, one line per row, quotes fields with commas and defuses formulas", () => {
  const csv = reportToCsv([
    { time: at, type: "fee", txHash: "0x1", positionId: "", marketId: "0xm", amount: "-5", detail: "feeType=TAKER, amount=5" },
    { time: at, type: "deposit", txHash: "0x2", positionId: "", marketId: "", amount: "-1000", detail: "=HYPERLINK(\"x\")" },
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "time,type,txHash,positionId,marketId,amount,detail");
  assert.equal(lines.length, 3);
  assert.ok(lines[1]!.endsWith('"feeType=TAKER, amount=5"'));
  assert.ok(lines[1]!.includes(",-5,"), "a negative number stays a number");
  assert.ok(lines[2]!.endsWith(`"'=HYPERLINK(""x"")"`), lines[2]);
});

test("dates take ISO strings or unix seconds and nothing else", () => {
  assert.equal(parseDate("2026-09-01")?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(parseDate("1788220800")?.toISOString(), "2026-09-01T00:00:00.000Z");
  assert.equal(parseDate("nope"), undefined);
  assert.equal(parseDate(""), undefined);
  assert.equal(parseDate(undefined), undefined);
});
