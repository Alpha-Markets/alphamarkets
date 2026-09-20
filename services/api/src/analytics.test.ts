import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANDLE_INTERVALS,
  MAX_CANDLE_LIMIT,
  mergeCandles,
  OI_RANGES,
  openInterestSeries,
  parseInterval,
  parseLimit,
  parseOiRange,
} from "./analytics.js";

test("intervals default to 5m and reject unknown keys", () => {
  assert.equal(parseInterval("1h"), "1h");
  assert.equal(parseInterval("2h"), "5m");
  assert.equal(parseInterval(undefined), "5m");
});

test("limits are whole numbers, positive, and capped", () => {
  assert.equal(parseLimit("50", 120, MAX_CANDLE_LIMIT), 50);
  assert.equal(parseLimit("100000", 120, MAX_CANDLE_LIMIT), MAX_CANDLE_LIMIT);
  for (const bad of ["0", "-3", "1.5", "abc", undefined]) assert.equal(parseLimit(bad, 120, MAX_CANDLE_LIMIT), 120);
});

test("candles get the volume of their bucket, or 0", () => {
  const candles = mergeCandles(
    [
      { time: 0, open: "1", high: "3", low: "1", close: "2" },
      { time: 300, open: "2", high: "2", low: "2", close: "2" },
    ],
    [
      { time: 300, volume: "5000" },
      { time: 600, volume: "9" }, // no price in this bucket: dropped
    ],
  );
  assert.deepEqual(candles.map((c) => c.volume), ["0", "5000"]);
  assert.equal(candles.length, 2);
});

test("the widest range keeps the point count bounded", () => {
  for (const { rangeSeconds, bucketSeconds } of Object.values(OI_RANGES)) {
    assert.ok(rangeSeconds / bucketSeconds <= 250);
  }
  assert.equal(parseOiRange("30d"), "30d");
  assert.equal(parseOiRange("1y"), "7d");
  assert.ok(CANDLE_INTERVALS["1m"] < CANDLE_INTERVALS["1d"]);
});

test("open interest keeps running long and short totals, starting before the window", () => {
  const deltas = [
    { time: 50, isLong: true, delta: 1_000n }, // before the window
    { time: 250, isLong: false, delta: 400n },
    { time: 450, isLong: true, delta: 500n },
    { time: 450, isLong: true, delta: -200n }, // reduced in the same bucket
    { time: 950, isLong: false, delta: -400n }, // short closed
  ];
  const series = openInterestSeries(deltas, 200, 200, 1000);

  assert.deepEqual(
    series.map((p) => [p.time, p.long, p.short]),
    [
      [200, "1000", "400"],
      [400, "1300", "400"],
      [600, "1300", "400"], // nothing happened: repeats
      [800, "1300", "0"], // the short closed at 950, inside this bucket
      [1000, "1300", "0"],
    ],
  );
});

test("no events gives flat zero totals, not an empty chart", () => {
  const series = openInterestSeries([], 100, 0, 300);
  assert.equal(series.length, 4);
  assert.ok(series.every((p) => p.long === "0" && p.short === "0"));
});
