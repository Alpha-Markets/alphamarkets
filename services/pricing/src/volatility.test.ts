import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseVolatility, realizedVolatility, YEAR_SECONDS, type PriceSample } from "./volatility.js";

const bounds = { minSamples: 10, min: 0.1, max: 3 };

/// A price that alternates between two values every `step` seconds: each return is +/- `move`.
function zigzag(count: number, step: number, move: number): PriceSample[] {
  return Array.from({ length: count }, (_, i) => ({ time: i * step, price: 100 * Math.exp(i % 2 === 0 ? 0 : move) }));
}

test("realized volatility matches the closed form for a known series", () => {
  // Every return is +/-0.001 over 1800s: variance rate is 1e-6 / 1800 per second.
  const expected = Math.sqrt((1e-6 / 1800) * YEAR_SECONDS);
  const measured = realizedVolatility(zigzag(50, 1800, 0.001), 10)!;
  assert.ok(Math.abs(measured - expected) / expected < 1e-9, `${measured} vs ${expected}`);
});

test("gaps in the samples do not inflate it: the same moves over longer spans measure lower", () => {
  const dense = realizedVolatility(zigzag(50, 1800, 0.001), 10)!;
  const sparse = realizedVolatility(zigzag(50, 7200, 0.001), 10)!;
  assert.ok(sparse < dense);
});

test("too few samples, or a flat price, has no volatility to measure", () => {
  assert.equal(realizedVolatility(zigzag(5, 60, 0.01), 10), undefined);
  const flat = Array.from({ length: 30 }, (_, i) => ({ time: i * 60, price: 190 }));
  assert.equal(realizedVolatility(flat, 10), undefined);
});

test("unsorted, duplicate-time and invalid samples are tolerated", () => {
  const samples = [...zigzag(30, 600, 0.002)].reverse();
  samples.push({ time: 0, price: Number.NaN }, { time: 5, price: -1 }, { time: 600, price: 100 });
  assert.ok(realizedVolatility(samples, 10)! > 0);
});

test("the chosen figure is clamped, and falls back with its source named", () => {
  const wild = chooseVolatility(zigzag(30, 60, 0.05), 0.5, bounds);
  assert.equal(wild.source, "realized");
  assert.equal(wild.value, 3);

  const calm = chooseVolatility(zigzag(30, 3600, 0.00001), 0.5, bounds);
  assert.equal(calm.source, "realized");
  assert.equal(calm.value, 0.1);

  assert.deepEqual(chooseVolatility([], 0.5, bounds), { value: 0.5, source: "default" });
});
