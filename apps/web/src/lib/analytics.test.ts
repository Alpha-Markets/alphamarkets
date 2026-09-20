import assert from "node:assert/strict";
import { test } from "node:test";
import { allFundingZero, averageFunding, longSharePercent, toFundingBars, toOiChartPoints, utilizationBps } from "./analytics.js";

test("long share is a whole percent and undefined without open interest", () => {
  assert.equal(longSharePercent(3n, 1n), 75);
  assert.equal(longSharePercent(0n, 5n), 0);
  assert.equal(longSharePercent(1n, 1n), 50);
  assert.equal(longSharePercent(0n, 0n), undefined);
});

test("utilization is basis points of the cap, undefined without one", () => {
  assert.equal(utilizationBps(250n, 1_000n), 2_500);
  assert.equal(utilizationBps(1_000n, 1_000n), 10_000);
  assert.equal(utilizationBps(5n, 0n), undefined);
});

test("open interest history converts base units to token units", () => {
  assert.deepEqual(toOiChartPoints([{ time: 9, long: 5_000_000_000n, short: 250_000n }], 6), [{ time: 9, long: 5000, short: 0.25 }]);
});

test("funding bps become percent per interval, and the mean covers signed rates", () => {
  const bars = toFundingBars([
    { time: 1, rateBps: 5n, cumulativeIndex: 5n, txHash: "0x1" },
    { time: 2, rateBps: -3n, cumulativeIndex: 2n, txHash: "0x2" },
  ]);
  assert.deepEqual(bars.map((b) => b.percent), [0.05, -0.03]);
  assert.ok(Math.abs(averageFunding(bars)! - 0.01) < 1e-12);
  assert.equal(averageFunding([]), undefined);
});

test("all-zero funding is recognised, an empty history is not", () => {
  assert.equal(allFundingZero([{ time: 1, percent: 0 }, { time: 2, percent: 0 }]), true);
  assert.equal(allFundingZero([{ time: 1, percent: 0 }, { time: 2, percent: 0.01 }]), false);
  assert.equal(allFundingZero([]), false);
});
