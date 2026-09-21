import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeSeries, toCandlePoints } from "./chart.js";

const WAD = 10n ** 18n;

test("candles convert from base units to plain numbers", () => {
  const [point] = toCandlePoints(
    [{ time: 60, open: 190n * WAD, high: 191n * WAD + WAD / 2n, low: 189n * WAD, close: 190n * WAD, volume: 2_500_000_000n }],
    6,
  );
  assert.deepEqual(point, { time: 60, open: 190, high: 191.5, low: 189, close: 190, volume: 2500 });
});

test("history and live samples merge into one strictly ascending series", () => {
  const history = [
    { time: 10, value: 1 },
    { time: 20, value: 2 },
  ];
  const live = [
    { time: 20, value: 2.5 },
    { time: 30, value: 3 },
  ];
  assert.deepEqual(mergeSeries(history, live), [
    { time: 10, value: 1 },
    { time: 20, value: 2.5 },
    { time: 30, value: 3 },
  ]);
  assert.deepEqual(mergeSeries([], []), []);
  assert.deepEqual(mergeSeries([{ time: 5, value: 1 }], [{ time: 1, value: 0 }]).map((p) => p.time), [1, 5]);
});
