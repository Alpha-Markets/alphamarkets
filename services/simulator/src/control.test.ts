import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendNudge, readNudges } from "./control.js";
import { deriveAccount } from "./wallets.js";

test("nudge requests are read once, in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "sim-"));
  try {
    assert.deepEqual(readNudges(dir, 0), { requests: [], lines: 0 });
    appendNudge(dir, { symbol: "NVDA", pct: -6, seconds: 90 });
    appendNudge(dir, { symbol: "TSLA", pct: 3, seconds: 60 });
    const first = readNudges(dir, 0);
    assert.equal(first.requests.length, 2);
    assert.equal(first.lines, 2);
    appendNudge(dir, { symbol: "AAPL", pct: -2, seconds: 30 });
    const second = readNudges(dir, first.lines);
    assert.deepEqual(second.requests, [{ symbol: "AAPL", pct: -2, seconds: 30 }]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("a broken line is skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "sim-"));
  try {
    appendNudge(dir, { symbol: "NVDA", pct: -1, seconds: 15 });
    appendFileSync(join(dir, "nudges.jsonl"), "{not json\n");
    assert.equal(readNudges(dir, 0).requests.length, 1);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("wallets come from the seed, repeatably and all different", () => {
  const a = Array.from({ length: 11 }, (_, i) => deriveAccount("seed-a", i).address);
  assert.deepEqual(a, Array.from({ length: 11 }, (_, i) => deriveAccount("seed-a", i).address));
  assert.equal(new Set(a).size, 11);
  assert.notEqual(deriveAccount("seed-b", 0).address, a[0]);
});
