import assert from "node:assert/strict";
import { test } from "node:test";
import { stringToHex } from "viem";
import { fmt, fmtBps, fmtCountdown, fmtPrice, fmtSigned, fmtUsd, shortHash } from "./format.js";
import { perpLabel, symbolOf } from "./market.js";

test("prices and money format from base units", () => {
  assert.equal(fmtPrice(184_480_000_000_000_000_000n), "184.48");
  assert.equal(fmtUsd(5_000_000_000n, 6), "$5,000.00");
  assert.equal(fmt(undefined, 6), "–");
});

test("signed money uses a real minus and no plus for zero", () => {
  assert.equal(fmtSigned(156_420_000n, 6), "+$156.42");
  assert.equal(fmtSigned(-5_000_000n, 6), "−$5.00");
  assert.equal(fmtSigned(0n, 6), "$0.00");
});

test("basis points format as a percentage", () => {
  assert.equal(fmtBps(8n), "0.08%");
  assert.equal(fmtBps(1000n), "10.00%");
});

test("funding countdown counts down and floors at zero", () => {
  assert.equal(fmtCountdown(1_000_000n + 8_072n, 1_000_000_000), "02:14:32");
  assert.equal(fmtCountdown(10n, 1_000_000_000), "00:00:00");
});

test("market symbols come from the bytes32 id, so new markets need no code", () => {
  const nvda = stringToHex("NVDA", { size: 32 });
  assert.equal(symbolOf(nvda), "NVDA");
  assert.equal(perpLabel(nvda), "NVDA-PERP");
  assert.equal(shortHash("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678");
});
