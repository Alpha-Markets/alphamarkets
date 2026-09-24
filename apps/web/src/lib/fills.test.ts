import assert from "node:assert/strict";
import { test } from "node:test";
import type { HistoryEvent } from "@alphamarkets/sdk";
import { FillIndex, parseCursor, summarize } from "./fills.js";

const WAD = 10n ** 18n;
let nextId = 1;
const ev = (eventName: string, args: Record<string, unknown>, txHash = `0x${nextId}`): HistoryEvent => ({
  id: nextId++,
  txHash,
  logIndex: 0,
  blockNumber: "1",
  contractName: "PerpsEngine",
  eventName,
  args,
  createdAt: "2026-01-01T00:00:00Z",
});

const opened = (positionId: string, isLong = true) =>
  ev("PerpPositionOpened", { positionId, owner: "0xabc", isLong, size: "5000000000", entryPrice: String(100n * WAD) });
const placed = (orderId: string, positionId: string, kind: string | number) =>
  ev("TriggerOrderPlaced", { orderId, owner: "0xabc", positionId, kind, triggerPrice: String(120n * WAD), expiry: "0" });
const executed = (orderId: string, positionId: string, txHash: string) =>
  ev("TriggerOrderExecuted", { orderId, owner: "0xabc", positionId, executionPrice: String(120n * WAD) }, txHash);
const closed = (positionId: string, realizedPnl: string, txHash: string) => ev("PerpPositionClosed", { positionId, realizedPnl }, txHash);

test("an executed take-profit order is a take-profit fill with its PnL and side", () => {
  const events = [opened("7"), placed("3", "7", "1"), executed("3", "7", "0xfill"), closed("7", "1000000000", "0xfill")];
  const index = new FillIndex();
  index.learn(events);
  const [fill, ...rest] = index.fillsIn(events);
  assert.equal(rest.length, 0);
  assert.equal(fill?.kind, "TAKE_PROFIT");
  assert.equal(fill?.pnl, 1_000_000_000n);
  assert.equal(fill?.price, 120n * WAD);
  assert.equal(fill?.isLong, true);
  assert.equal(fill?.size, 5_000_000_000n);
});

test("a stop-loss order is told apart from a take-profit one by the kind it was placed with", () => {
  const events = [opened("8"), placed("4", "8", 0), executed("4", "8", "0xsl"), closed("8", "-400000000", "0xsl")];
  const index = new FillIndex();
  index.learn(events);
  assert.equal(index.fillsIn(events)[0]?.kind, "STOP_LOSS");
  assert.equal(index.fillsIn(events)[0]?.pnl, -400_000_000n);
});

test("a fill whose order placement is out of view falls back on the sign of the PnL, or stays generic", () => {
  const withPnl = [executed("9", "9", "0xa"), closed("9", "250", "0xa")];
  const a = new FillIndex();
  a.learn(withPnl);
  assert.equal(a.fillsIn(withPnl)[0]?.kind, "TAKE_PROFIT");

  const lossy = [executed("10", "10", "0xb"), closed("10", "-250", "0xb")];
  const b = new FillIndex();
  b.learn(lossy);
  assert.equal(b.fillsIn(lossy)[0]?.kind, "STOP_LOSS");

  const bare = [executed("11", "11", "0xc")];
  const c = new FillIndex();
  c.learn(bare);
  assert.equal(c.fillsIn(bare)[0]?.kind, "TRIGGER");
  assert.equal(c.fillsIn(bare)[0]?.pnl, undefined);
});

test("a close in another transaction is not attributed to the fill", () => {
  const events = [executed("12", "12", "0xfill"), closed("12", "999", "0xother")];
  const index = new FillIndex();
  index.learn(events);
  assert.equal(index.fillsIn(events)[0]?.pnl, undefined);
});

test("a liquidation is a liquidation fill, and a manual close is not a fill at all", () => {
  const events = [
    ev("PositionLiquidated", { positionId: "13", owner: "0xabc", liquidator: "0xdef", markPriceAtLiquidation: String(90n * WAD), pnl: "-800", fee: "5" }),
    closed("14", "50", "0xmanual"),
  ];
  const index = new FillIndex();
  index.learn(events);
  const fills = index.fillsIn(events);
  assert.equal(fills.length, 1);
  assert.equal(fills[0]?.kind, "LIQUIDATION");
  assert.equal(fills[0]?.pnl, -800n);
});

test("what an earlier read taught the index still resolves a later fill", () => {
  const index = new FillIndex();
  index.learn([opened("15", false), placed("6", "15", 1)]);
  const later = [executed("6", "15", "0xlate")];
  index.learn(later);
  const fill = index.fillsIn(later)[0];
  assert.equal(fill?.kind, "TAKE_PROFIT");
  assert.equal(fill?.isLong, false);
});

test("a summary adds up only the fills that know their PnL", () => {
  const base = { positionId: "1", txHash: "0x", kind: "TAKE_PROFIT" as const };
  assert.deepEqual(summarize([{ ...base, id: 1, pnl: 100n }, { ...base, id: 2, pnl: -30n }, { ...base, id: 3 }]), { count: 3, pnl: 70n });
  assert.deepEqual(summarize([{ ...base, id: 1 }]), { count: 1, pnl: undefined });
});

test("a stored cursor that is missing or damaged reads as no cursor", () => {
  assert.equal(parseCursor(null), undefined);
  assert.equal(parseCursor("abc"), undefined);
  assert.equal(parseCursor("-3"), undefined);
  assert.equal(parseCursor("42"), 42);
  assert.equal(parseCursor("0"), 0);
});
