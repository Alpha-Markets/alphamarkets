import assert from "node:assert/strict";
import { test } from "node:test";
import { hedgeActions, hedgeBook, optionBookDelta, perpUnits, planHedge } from "./hedging.js";

const WAD = 10n ** 18n;
const usd = (n: number) => BigInt(n) * 10n ** 6n;
const close = (a: number, b: number, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not ${b}`);

test("option delta is per-unit delta times contracts times contract size", () => {
  // 10 calls of 100 shares at delta 0.6, and 5 puts of 100 at delta -0.4.
  close(optionBookDelta([{ delta: 0.6, contracts: 10n, contractSize: 100n * WAD }, { delta: -0.4, contracts: 5n, contractSize: 100n * WAD }]), 600 - 200);
  assert.equal(optionBookDelta([]), 0);
});

test("a perp is long or short its notional divided by the entry price", () => {
  close(perpUnits({ isLong: true, size: usd(1_900), entryPrice: 190n * WAD, settlementDecimals: 6 }), 10);
  close(perpUnits({ isLong: false, size: usd(1_900), entryPrice: 190n * WAD, settlementDecimals: 6 }), -10);
  assert.equal(perpUnits({ isLong: true, size: usd(1), entryPrice: 0n, settlementDecimals: 6 }), 0);
});

test("the plan trades the gap to the target, and nothing inside the tolerance", () => {
  assert.deepEqual(planHedge({ optionDelta: 400, perpDelta: 0 }), { netDelta: 400, targetDelta: 0, adjustUnits: -400 });
  assert.equal(planHedge({ optionDelta: 400, perpDelta: -395, toleranceUnits: 10 }).adjustUnits, 0);
  assert.equal(planHedge({ optionDelta: 400, perpDelta: -380, toleranceUnits: 10 }).adjustUnits, -20);
  assert.equal(planHedge({ optionDelta: 400, perpDelta: 0, targetDelta: 100 }).adjustUnits, -300);
  assert.throws(() => planHedge({ optionDelta: Number.NaN, perpDelta: 0 }), /finite/);
  assert.throws(() => planHedge({ optionDelta: 1, perpDelta: 0, toleranceUnits: -1 }), /not negative/);
});

test("selling delta with no perps opens a short of the right notional", () => {
  const actions = hedgeActions([], -400, 190n * WAD, 6);
  assert.deepEqual(actions, [{ type: "open", side: "SHORT", notional: usd(76_000) }]);
  assert.deepEqual(hedgeActions([], 10, 190n * WAD, 6), [{ type: "open", side: "LONG", notional: usd(1_900) }]);
});

test("existing opposite positions are closed or reduced first, oldest first, then a new one opens", () => {
  const positions = [
    { positionId: 2n, isLong: false, size: usd(1_000), entryPrice: 190n * WAD },
    { positionId: 1n, isLong: false, size: usd(2_000), entryPrice: 190n * WAD },
    { positionId: 3n, isLong: true, size: usd(5_000), entryPrice: 190n * WAD },
  ];
  // Buy $2,500 worth at the mark: close the oldest short (2,000) and reduce the next by 500.
  const actions = hedgeActions(positions, 2_500 / 190, 190n * WAD, 6);
  assert.equal(actions[0]!.type, "close");
  assert.equal((actions[0] as { positionId: bigint }).positionId, 1n);
  assert.equal(actions[1]!.type, "reduce");
  assert.equal((actions[1] as { positionId: bigint }).positionId, 2n);
  const reduced = (actions[1] as { size: bigint }).size;
  assert.ok(reduced >= usd(499) && reduced <= usd(500), `${reduced}`);
  assert.equal(actions.length, 2, "the long is never touched when buying");

  const more = hedgeActions(positions, 4_000 / 190, 190n * WAD, 6);
  assert.deepEqual(more.map((a) => a.type), ["close", "close", "open"]);
  assert.equal((more[2] as { notional: bigint }).notional > usd(999) && (more[2] as { notional: bigint }).notional <= usd(1_000), true);
});

test("a position that moved is valued at the mark, not at its entry notional", () => {
  // A short opened at 200 for $2,000 is worth 2,000 * 100/200 = $1,000 exposure at a mark of 100, so
  // buying $500 of exposure reduces it by a $1,000 share of its entry notional (500 * 200 / 100).
  const [action] = hedgeActions([{ positionId: 1n, isLong: false, size: usd(2_000), entryPrice: 200n * WAD }], 5, 100n * WAD, 6);
  assert.deepEqual(action, { type: "reduce", positionId: 1n, size: usd(1_000) });
});

test("an adjustment under the minimum notional, or no mark, gives no action", () => {
  assert.deepEqual(hedgeActions([], 0.01, 190n * WAD, 6, usd(10)), []);
  assert.deepEqual(hedgeActions([], 0, 190n * WAD, 6), []);
  assert.deepEqual(hedgeActions([], 5, 0n, 6), []);
  assert.throws(() => hedgeActions([], Number.NaN, 190n * WAD, 6), /finite/);
});

test("hedgeBook ties it together: the book's delta, the net, and the trades that neutralise it", () => {
  const plan = hedgeBook({
    options: [{ delta: 0.5, contracts: 10n, contractSize: 100n * WAD }], // +500 units
    perps: [{ positionId: 1n, isLong: false, size: usd(19_000), entryPrice: 190n * WAD }], // -100 units
    markPrice: 190n * WAD,
    settlementDecimals: 6,
    toleranceUnits: 5,
  });
  close(plan.optionDelta, 500);
  close(plan.perpDelta, -100);
  close(plan.netDelta, 400);
  close(plan.adjustUnits, -400);
  assert.deepEqual(plan.actions, [{ type: "open", side: "SHORT", notional: usd(76_000) }]);
});
