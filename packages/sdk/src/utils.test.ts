import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToHex } from "viem";
import { createExplorer } from "./explorer.js";
import { defaultDeadline, resolveMarketId, toInteger, toUnixSeconds } from "./utils.js";

test("resolveMarketId accepts symbol, PERP label and bytes32", () => {
  const nvda = stringToHex("NVDA", { size: 32 });
  assert.equal(resolveMarketId("NVDA"), nvda);
  assert.equal(resolveMarketId("NVDA-PERP"), nvda);
  assert.equal(resolveMarketId("nvda-perp".toUpperCase()), nvda);
  assert.equal(resolveMarketId(nvda), nvda);
});

test("toInteger rejects fractions and negatives", () => {
  assert.equal(toInteger(5, "leverage"), 5n);
  assert.equal(toInteger(7n, "leverage"), 7n);
  assert.throws(() => toInteger(1.5, "leverage"), /leverage must be a non-negative integer/);
  assert.throws(() => toInteger(-1, "contracts"), /contracts must be a non-negative integer/);
});

test("toUnixSeconds accepts bigint, Date and ISO strings", () => {
  assert.equal(toUnixSeconds(1_800_000_000n), 1_800_000_000n);
  assert.equal(toUnixSeconds(new Date("2026-09-25T00:00:00Z")), 1_790_294_400n);
  assert.equal(toUnixSeconds("2026-09-25"), 1_790_294_400n);
  assert.throws(() => toUnixSeconds("not a date"), /Invalid expiry/);
});

test("defaultDeadline is five minutes ahead", () => {
  assert.equal(defaultDeadline(1_000_000_000_000), 1_000_000_000n + 300n);
});

test("explorer links come from the caller-supplied base URL", () => {
  const explorer = createExplorer("https://explorer.example/");
  assert.equal(explorer.txUrl("0xabc"), "https://explorer.example/tx/0xabc");
  assert.equal(explorer.blockUrl(12n), "https://explorer.example/block/12");
  assert.throws(() => createExplorer().txUrl("0xabc"), /explorerUrl/);
});
