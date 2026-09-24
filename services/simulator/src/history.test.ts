import assert from "node:assert/strict";
import { test } from "node:test";
import { deleteStatements, generateHistory, historyRows, insertStatements } from "./history.js";
import { createRng } from "./prng.js";

const MARKET = `0x${"4e56444100".padEnd(64, "0")}`;

test("the history is deterministic and one price per minute", () => {
  const a = generateHistory({ symbol: "NVDA", endPrice: 190, minutes: 360, rng: createRng(1) });
  const b = generateHistory({ symbol: "NVDA", endPrice: 190, minutes: 360, rng: createRng(1) });
  assert.deepEqual(a, b);
  assert.equal(a.length, 360);
  assert.notDeepEqual(a, generateHistory({ symbol: "NVDA", endPrice: 190, minutes: 360, rng: createRng(2) }));
});

test("the history joins the real price without a jump", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const path = generateHistory({ symbol: "TSLA", endPrice: 350, minutes: 360, rng: createRng(seed) });
    const jump = Math.abs(path[path.length - 1]! / 350 - 1);
    assert.ok(jump < 0.01, `the last minute is ${jump} away from the real price`);
  }
});

test("the history moves, but stays inside a believable range", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const path = generateHistory({ symbol: "NVDA", endPrice: 190, minutes: 720, rng: createRng(seed) });
    const high = Math.max(...path);
    const low = Math.min(...path);
    assert.ok(high / low - 1 > 0.004, "a flat history is no use on a chart");
    assert.ok(high / 190 < 1.25 && low / 190 > 0.8, `range ${low} to ${high}`);
    for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i]! / path[i - 1]! - 1) < 0.03, "a single minute moved like a glitch");
  }
});

test("prices are in whole cents and positive", () => {
  for (const price of generateHistory({ symbol: "HOOD", endPrice: 100, minutes: 200, rng: createRng(9) })) {
    assert.ok(price > 0);
    assert.ok(Math.abs(price * 100 - Math.round(price * 100)) < 1e-6);
  }
});

test("rows are one minute apart and the newest ends a minute before the real price", () => {
  const end = new Date("2026-09-21T16:45:00.000Z");
  const rows = historyRows(MARKET, [10, 11, 12], end);
  assert.deepEqual(rows.map((r) => r.at.toISOString()), ["2026-09-21T16:42:00.000Z", "2026-09-21T16:43:00.000Z", "2026-09-21T16:44:00.000Z"]);
  assert.equal(rows[0]!.price, 10_000_000_000_000_000_000n);
});

test("the SQL is chunked, and refuses a value that is not a market id", () => {
  const rows = historyRows(MARKET, Array.from({ length: 1_200 }, () => 100), new Date("2026-09-21T16:45:00.000Z"));
  const statements = insertStatements(rows);
  assert.equal(statements.length, 3);
  assert.match(statements[0]!, /^INSERT INTO price_ticks \(market_id, price, sampled_at\) VALUES \('0x/);
  assert.throws(() => insertStatements([{ marketId: "x'; DROP TABLE events; --", price: 1n, at: new Date() }]), /not a market id/);
  assert.throws(() => generateHistory({ symbol: "NVDA", endPrice: 190, minutes: 1, rng: createRng(1) }), /at least 2 minutes/);
});

test("deleteStatements clears each market from the start of the window and refuses a bad id", () => {
  const from = new Date("2026-09-20T00:00:00.000Z");
  const statements = deleteStatements([MARKET], from);
  assert.equal(statements.length, 1);
  assert.match(statements[0]!, /DELETE FROM price_ticks WHERE market_id = '0x[0-9a-f]{64}' AND sampled_at >= '2026-09-20T00:00:00.000Z';/);
  assert.throws(() => deleteStatements(["0x1'; DROP TABLE price_ticks; --"], from), /not a market id/);
  assert.throws(() => deleteStatements([MARKET], new Date("nope")), /not a date/);
});
