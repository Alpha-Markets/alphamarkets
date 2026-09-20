import assert from "node:assert/strict";
import { test } from "node:test";
import { addressesForChain, OPTIONAL_CONTRACTS, resolveAddresses } from "./deployments.js";
import { ROBINHOOD_TESTNET_CHAIN_ID } from "./chains.js";

const ADDRESS = `0x${"ab".repeat(20)}`;

test("without overrides the recorded deployment is returned", () => {
  assert.deepEqual(resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, {}), addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID));
});

test("overrides replace only the named contracts", () => {
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ORIONIS_ADDRESSES: JSON.stringify({ optionsEngine: ADDRESS }) });
  const recorded = addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID);
  assert.equal(resolved.optionsEngine, ADDRESS);
  assert.equal(resolved.vault, recorded.vault);
});

test("a typo or malformed value is an error, never a silent fallback", () => {
  const resolve = (value: unknown) =>
    resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ORIONIS_ADDRESSES: JSON.stringify(value) });
  assert.throws(() => resolve({ optionEngine: ADDRESS }), /unknown contract "optionEngine"/);
  assert.throws(() => resolve({ optionsEngine: "0x123" }), /is not an address/);
  assert.throws(() => resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ORIONIS_ADDRESSES: "{not json" }), /not valid JSON/);
});

test("an optional contract (one added after older deployments) is a known override key", () => {
  // `perpOrderManager` is absent from deployments made before limit orders, so a fresh or local
  // deployment must be able to supply it even when the recorded one does not have it.
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ORIONIS_ADDRESSES: JSON.stringify({ perpOrderManager: ADDRESS }) });
  assert.equal(resolved.perpOrderManager, ADDRESS);
  assert.ok(OPTIONAL_CONTRACTS.includes("perpOrderManager"));
});
