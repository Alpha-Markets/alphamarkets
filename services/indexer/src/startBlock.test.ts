import assert from "node:assert/strict";
import { test } from "node:test";
import { blockBeforeFirstIndexed } from "./startBlock.js";

test("without a configured block the indexer starts at the head", () => {
  assert.equal(blockBeforeFirstIndexed(1_000n, undefined), 999n);
  assert.equal(blockBeforeFirstIndexed(1_000n, ""), 999n);
  assert.equal(blockBeforeFirstIndexed(0n, undefined), 0n);
});

test("a configured block is the first one indexed", () => {
  assert.equal(blockBeforeFirstIndexed(1_000n, "122"), 121n);
  assert.equal(blockBeforeFirstIndexed(1_000n, " 122 "), 121n);
  assert.equal(blockBeforeFirstIndexed(1_000n, "1000"), 999n, "the head itself is allowed");
  assert.equal(blockBeforeFirstIndexed(1_000n, "0"), 0n);
});

test("a bad or future block is an error, never a silent start at the head", () => {
  for (const value of ["abc", "-5", "12.5", "0x10"]) {
    assert.throws(() => blockBeforeFirstIndexed(1_000n, value), /whole block number/, value);
  }
  assert.throws(() => blockBeforeFirstIndexed(1_000n, "1001"), /past the chain head/);
});
