import assert from "node:assert/strict";
import { test } from "node:test";
import { chartRange, defaultStrikeValues, fmtLimit, fmtNet, fmtSignedUsd, strikesFromValues, STRATEGY_FIELDS } from "./strategies.js";

const ladder = [80, 85, 90, 95, 100, 105, 110];

test("default strikes sit on the rungs around the nearest one", () => {
  assert.deepEqual(defaultStrikeValues("STRADDLE", ladder, 4), [100]);
  assert.deepEqual(defaultStrikeValues("STRANGLE", ladder, 4), [95, 105]);
  assert.deepEqual(defaultStrikeValues("IRON_CONDOR", ladder, 4), [90, 95, 105, 110]);
  assert.deepEqual(defaultStrikeValues("COVERED_CALL", ladder, 4), [105]);
  assert.deepEqual(defaultStrikeValues("BULL_CALL_SPREAD", ladder, 4), [100, 105]);
});

test("default strikes stay on the ladder at its ends and give nothing for an empty ladder", () => {
  assert.deepEqual(defaultStrikeValues("IRON_CONDOR", ladder, 0), [80, 80, 85, 90]);
  assert.deepEqual(defaultStrikeValues("STRANGLE", ladder, 6), [105, 110]);
  assert.deepEqual(defaultStrikeValues("STRADDLE", [], 0), []);
});

test("every strategy has one field per strike value it takes", () => {
  for (const kind of Object.keys(STRATEGY_FIELDS) as Array<keyof typeof STRATEGY_FIELDS>) {
    assert.equal(defaultStrikeValues(kind, ladder, 4).length, STRATEGY_FIELDS[kind].length, kind);
  }
});

test("values map onto the strike names each strategy uses", () => {
  assert.deepEqual(strikesFromValues("COVERED_CALL", [105]), { callStrike: 105 });
  assert.deepEqual(strikesFromValues("BULL_CALL_SPREAD", [100, 105]), { lowStrike: 100, highStrike: 105 });
  assert.deepEqual(strikesFromValues("STRANGLE", [95, 105]), { putStrike: 95, callStrike: 105 });
  assert.deepEqual(strikesFromValues("IRON_CONDOR", [90, 95, 105, 110]), { wings: [90, 95, 105, 110] });
  assert.deepEqual(strikesFromValues("IRON_CONDOR", [90, 95]), {}, "an incomplete condor is not guessed");
});

test("figures format as signed, limited and debit or credit", () => {
  assert.equal(fmtSignedUsd(12.5), "+$12.50");
  assert.equal(fmtSignedUsd(-3.2), "−$3.20");
  assert.equal(fmtLimit(null), "Unlimited");
  assert.equal(fmtLimit(5), "$5.00");
  assert.equal(fmtNet(5), "$5.00 debit");
  assert.equal(fmtNet(-3.5), "$3.50 credit");
});

test("the chart window covers the strikes and break-evens with room, never below zero", () => {
  const [low, high] = chartRange([90, 110], [85, 115], 100);
  assert.ok(low < 85 && high > 115);
  const [floor] = chartRange([1], [0.5], 1);
  assert.ok(floor >= 0);
});
