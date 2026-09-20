import assert from "node:assert/strict";
import { test } from "node:test";
import type { TriggerOrder } from "@alphamarkets/sdk";
import { openTriggersFor, sortTriggers, triggerProblem, triggerSide, triggerState } from "./triggers.js";

const WAD = 10n ** 18n;
const MARK = 190n * WAD;

const order = (id: bigint, overrides: Partial<TriggerOrder> = {}): TriggerOrder => ({
  id,
  positionId: 5n,
  kind: "STOP_LOSS",
  triggerPrice: 180n * WAD,
  expiry: 1_000n,
  owner: `0x${"01".repeat(20)}`,
  status: "OPEN",
  ...overrides,
});

test("a long's stop-loss and a short's take-profit sit below the mark", () => {
  assert.equal(triggerSide(true, "STOP_LOSS"), "below");
  assert.equal(triggerSide(true, "TAKE_PROFIT"), "above");
  assert.equal(triggerSide(false, "STOP_LOSS"), "above");
  assert.equal(triggerSide(false, "TAKE_PROFIT"), "below");
});

test("a trigger on the wrong side of the mark is explained, a valid one is not", () => {
  assert.match(triggerProblem(true, "STOP_LOSS", "195", MARK) ?? "", /stop-loss must be below the mark/);
  assert.match(triggerProblem(true, "STOP_LOSS", "190", MARK) ?? "", /below/, "the mark itself would fire at once");
  assert.equal(triggerProblem(true, "STOP_LOSS", "180", MARK), undefined);
  assert.match(triggerProblem(true, "TAKE_PROFIT", "185", MARK) ?? "", /take-profit must be above/);
  assert.equal(triggerProblem(true, "TAKE_PROFIT", "200", MARK), undefined);
  assert.match(triggerProblem(false, "STOP_LOSS", "180", MARK) ?? "", /short's stop-loss must be above/);
  assert.equal(triggerProblem(false, "TAKE_PROFIT", "170", MARK), undefined);
});

test("empty input is not an error yet, junk is, and no mark means no side check", () => {
  assert.equal(triggerProblem(true, "STOP_LOSS", "", MARK), undefined);
  assert.equal(triggerProblem(true, "STOP_LOSS", "  ", MARK), undefined);
  for (const bad of ["0", "-1", "abc", "1e3"]) assert.match(triggerProblem(true, "STOP_LOSS", bad, MARK) ?? "", /above zero/, bad);
  assert.equal(triggerProblem(true, "STOP_LOSS", "195", undefined), undefined);
});

test("an order reads as fired, cancelled, expired or on a closed position, else open", () => {
  assert.equal(triggerState(order(1n, { status: "EXECUTED" }), 100n, true), "fired");
  assert.equal(triggerState(order(1n, { status: "CANCELLED" }), 100n, true), "cancelled");
  assert.equal(triggerState(order(1n), 1_001n, true), "expired");
  assert.equal(triggerState(order(1n), 100n, false), "position closed");
  assert.equal(triggerState(order(1n), 100n, true), "open");
  assert.equal(triggerState(order(1n), 100n, undefined), "open", "an unknown position is not assumed closed");
  assert.equal(triggerState(order(1n), 1_000n, true), "open", "the last second still counts");
});

test("only waiting orders of the given position are listed, newest first", () => {
  const orders = [
    order(1n),
    order(2n, { kind: "TAKE_PROFIT" }),
    order(3n, { positionId: 6n }),
    order(4n, { status: "CANCELLED" }),
    order(5n, { expiry: 50n }),
  ];
  assert.deepEqual(openTriggersFor(orders, 5n, 100n).map((o) => o.id), [2n, 1n]);
});

test("waiting orders come first, then a few finished ones", () => {
  const orders = [
    order(1n, { status: "EXECUTED" }),
    order(2n),
    order(3n, { positionId: 9n }),
    ...[4n, 5n, 6n, 7n, 8n, 9n].map((id) => order(id, { status: "CANCELLED" })),
  ];
  const sorted = sortTriggers(orders, 100n, (id) => (id === 9n ? false : true));
  assert.deepEqual(sorted.slice(0, 1).map((o) => o.id), [2n], "only order 2 is waiting; 3 is on a closed position");
  assert.equal(sorted.length, 1 + 5, "finished ones are capped at five");
});
