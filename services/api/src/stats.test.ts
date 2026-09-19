import assert from "node:assert/strict";
import { test } from "node:test";
import { changeBps, parseRange, RANGES } from "./stats.js";

const WAD = 10n ** 18n;

test("change is in basis points against the baseline price", () => {
  assert.equal(changeBps((205n * WAD).toString(), (200n * WAD).toString()), 250);
  assert.equal(changeBps((190n * WAD).toString(), (200n * WAD).toString()), -500);
  assert.equal(changeBps((200n * WAD).toString(), (200n * WAD).toString()), 0);
});

test("no baseline or a zero baseline gives no change rather than a wrong one", () => {
  assert.equal(changeBps("1", null), null);
  assert.equal(changeBps(null, "1"), null);
  assert.equal(changeBps("100", "0"), null);
});

test("ranges default to 24h and reject unknown keys", () => {
  assert.equal(parseRange("7d"), "7d");
  assert.equal(parseRange("nonsense"), "24h");
  assert.equal(parseRange(undefined), "24h");
  assert.ok(RANGES["7d"].rangeSeconds / RANGES["7d"].bucketSeconds < 1000, "keeps the point count bounded");
});
