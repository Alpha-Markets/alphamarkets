import assert from "node:assert/strict";
import { test } from "node:test";
import { candleLayout, priceScale, toCandlePoints, volumeBar, type CandlePoint } from "./chart.js";

const WAD = 10n ** 18n;
const candle = (open: number, high: number, low: number, close: number): CandlePoint => ({ time: 0, open, high, low, close, volume: 0 });

test("candles convert from base units to plain numbers", () => {
  const [point] = toCandlePoints(
    [{ time: 60, open: 190n * WAD, high: 191n * WAD + WAD / 2n, low: 189n * WAD, close: 190n * WAD, volume: 2_500_000_000n }],
    6,
  );
  assert.deepEqual(point, { time: 60, open: 190, high: 191.5, low: 189, close: 190, volume: 2500 });
});

test("the price scale contains every wick and every extra level, high at the top", () => {
  const scale = priceScale([candle(100, 110, 95, 105)], [90, 120], 300);
  assert.ok(scale.lo < 90 && scale.hi > 120);
  assert.ok(scale.y(120) < scale.y(110) && scale.y(110) < scale.y(95) && scale.y(95) < scale.y(90));
  assert.ok(scale.y(scale.hi) === 0 && Math.abs(scale.y(scale.lo) - 300) < 1e-9);
});

test("a flat market still gets a usable scale", () => {
  const scale = priceScale([candle(190, 190, 190, 190)], [], 300);
  assert.ok(scale.hi > scale.lo);
  assert.ok(Number.isFinite(scale.y(190)));
});

test("candles sit at the right edge and a short history does not stretch", () => {
  const layout = candleLayout(3, 1000, 100); // slots are 10px wide
  assert.equal(layout.slot, 10);
  assert.equal(layout.x(2), 995, "the newest candle ends at the right edge");
  assert.equal(layout.x(0), 975);
  assert.equal(layout.indexAt(999), 2);
  assert.equal(layout.indexAt(0), 0, "clamped on the left");
  assert.equal(layout.indexAt(976), 0);
  assert.ok(layout.body > 0 && layout.body < layout.slot);
});

test("volume bars scale to the busiest bucket and never vanish when there was any", () => {
  assert.equal(volumeBar(50, 100, 40), 20);
  assert.equal(volumeBar(100, 100, 40), 40);
  assert.equal(volumeBar(0, 100, 40), 0);
  assert.equal(volumeBar(1, 1_000_000, 40), 1);
  assert.equal(volumeBar(5, 0, 40), 0);
});
