import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "./analytics.js";
import { bucketBars, dollarVolume, mergeHistory, parseYahooBars, pastPricePoints } from "./externalCandles.js";

const candle = (time: number): Candle => ({ time, open: "1", high: "1", low: "1", close: "1", volume: "0" });

test("bars regroup into epoch-aligned buckets with the right open, high, low and close", () => {
  // Yahoo hourly bars start at :30; the indexed 1h buckets start on the hour.
  const bars = [
    { time: 3_600 * 10 + 1_800, open: 10, high: 12, low: 9, close: 11 },
    { time: 3_600 * 11 + 1_800, open: 11, high: 15, low: 10, close: 14 },
  ];
  const candles = bucketBars(bars, 3_600);
  assert.deepEqual(candles.map((c) => c.time), [3_600 * 10, 3_600 * 11]);

  const [merged] = bucketBars([bars[0]!, { time: 3_600 * 10 + 2_400, open: 11, high: 13, low: 8, close: 12 }], 3_600);
  assert.deepEqual(
    { open: merged!.open, high: merged!.high, low: merged!.low, close: merged!.close, volume: merged!.volume },
    { open: "10000000000000000000", high: "13000000000000000000", low: "8000000000000000000", close: "12000000000000000000", volume: "0" },
  );
});

test("prices are 18-decimal fixed point without float noise", () => {
  const [one] = bucketBars([{ time: 0, open: 224.58000183105, high: 224.58, low: 224.58, close: 224.58 }], 60);
  assert.equal(one!.open, "224580001830000000000");
  assert.equal(one!.close, "224580000000000000000");
});

test("Yahoo bars with a null price are skipped", () => {
  const bars = parseYahooBars({
    chart: {
      result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 3], high: [1, null, 3], low: [1, null, 3], close: [1, null, 3] }] } }],
    },
  });
  assert.deepEqual(bars.map((bar) => bar.time), [1, 3]);
  assert.deepEqual(parseYahooBars({}), []);
});

test("past candles stop where the indexed ones begin, and the newest are kept", () => {
  const merged = mergeHistory([candle(1), candle(2), candle(3), candle(4)], [candle(3), candle(4), candle(5)], 100);
  assert.deepEqual(merged.map((c) => c.time), [1, 2, 3, 4, 5]);
  assert.deepEqual(mergeHistory([candle(1), candle(2)], [], 100).map((c) => c.time), [1, 2]);
  assert.deepEqual(mergeHistory([candle(1), candle(2), candle(3)], [candle(4)], 2).map((c) => c.time), [3, 4]);
});

test("line points come from past closes inside the window and before the indexed data", () => {
  const past = [candle(100), candle(400), candle(700), candle(1_000)].map((c, i) => ({ ...c, close: String(i + 1) }));
  const points = pastPricePoints(past, 300, 1_000, 600);
  // 400 and 700 fall in [300, 1000); they thin to one point per 600 s bucket (0 and 600).
  assert.deepEqual(points, [
    { time: 0, price: "2" },
    { time: 600, price: "3" },
  ]);
});

test("underlying dollar volume is the last bar's share volume times its close", () => {
  assert.equal(dollarVolume([{ close: 10, volume: 5 }, { close: 200.5, volume: 1_000 }]), "200500");
  assert.equal(dollarVolume([{ close: 10, volume: null }]), null);
  assert.equal(dollarVolume([]), null);
});
