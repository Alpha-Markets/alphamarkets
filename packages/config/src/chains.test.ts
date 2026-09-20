import assert from "node:assert/strict";
import { test } from "node:test";
import { ROBINHOOD_TESTNET_CHAIN_ID, resolveChainId } from "./chains.js";

test("an unset or blank chain id means the recorded deployment", () => {
  assert.equal(resolveChainId(undefined), ROBINHOOD_TESTNET_CHAIN_ID);
  assert.equal(resolveChainId(""), ROBINHOOD_TESTNET_CHAIN_ID);
  assert.equal(resolveChainId("  "), ROBINHOOD_TESTNET_CHAIN_ID);
});

test("a chain with a recorded deployment is accepted", () => {
  assert.equal(resolveChainId(String(ROBINHOOD_TESTNET_CHAIN_ID)), ROBINHOOD_TESTNET_CHAIN_ID);
});

test("an unknown or malformed chain id is an error, never a fallback to another network", () => {
  for (const value of ["1", "0", "-1", "abc", "46630.5", "4663O"]) {
    assert.throws(() => resolveChainId(value), /no deployment recorded/, value);
  }
});
