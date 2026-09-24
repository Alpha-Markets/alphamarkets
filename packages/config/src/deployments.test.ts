import assert from "node:assert/strict";
import { test } from "node:test";
import { addressesForChain, OPTIONAL_CONTRACTS, protocolTokens, resolveAddresses } from "./deployments.js";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID } from "./chains.js";

const ADDRESS = `0x${"ab".repeat(20)}`;

test("without overrides the recorded deployment is returned", () => {
  assert.deepEqual(resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, {}), addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID));
});

test("overrides replace only the named contracts", () => {
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ALPHAMARKETS_ADDRESSES: JSON.stringify({ optionsEngine: ADDRESS }) });
  const recorded = addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID);
  assert.equal(resolved.optionsEngine, ADDRESS);
  assert.equal(resolved.vault, recorded.vault);
});

test("a typo or malformed value is an error, never a silent fallback", () => {
  const resolve = (value: unknown) =>
    resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ALPHAMARKETS_ADDRESSES: JSON.stringify(value) });
  assert.throws(() => resolve({ optionEngine: ADDRESS }), /unknown contract "optionEngine"/);
  assert.throws(() => resolve({ optionsEngine: "0x123" }), /is not an address/);
  assert.throws(() => resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ALPHAMARKETS_ADDRESSES: "{not json" }), /not valid JSON/);
});

test("an optional contract (one added after older deployments) is a known override key", () => {
  // `perpOrderManager` is absent from deployments made before limit orders, so a fresh or local
  // deployment must be able to supply it even when the recorded one does not have it.
  const resolved = resolveAddresses(ROBINHOOD_TESTNET_CHAIN_ID, { ALPHAMARKETS_ADDRESSES: JSON.stringify({ perpOrderManager: ADDRESS }) });
  assert.equal(resolved.perpOrderManager, ADDRESS);
  assert.ok(OPTIONAL_CONTRACTS.includes("perpOrderManager"));
});

test("mainnet and testnet never share a contract address", () => {
  const testnet = new Set(Object.values(addressesForChain(ROBINHOOD_TESTNET_CHAIN_ID)));
  for (const [name, address] of Object.entries(addressesForChain(ROBINHOOD_MAINNET_CHAIN_ID))) {
    assert.ok(!testnet.has(address), `${name} on mainnet equals a testnet address`);
  }
});

test("the mainnet settlement token is USDG", () => {
  assert.equal(addressesForChain(ROBINHOOD_MAINNET_CHAIN_ID).settlementToken, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
});

test("only mainnet records a protocol token, and it is a valid address", () => {
  assert.equal(protocolTokens[ROBINHOOD_TESTNET_CHAIN_ID], undefined);
  const token = protocolTokens[ROBINHOOD_MAINNET_CHAIN_ID];
  assert.ok(token);
  assert.match(token.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(token.symbol, "ALPHA");
});
