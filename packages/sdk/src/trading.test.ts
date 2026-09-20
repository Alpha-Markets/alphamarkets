import assert from "node:assert/strict";
import { test } from "node:test";
import { BaseError } from "viem";
import { decodeFunctionData } from "viem";
import { erc20Abi, optionsEngineAbi, perpsEngineAbi, rfqManagerAbi, vaultAbi } from "./abis.js";
import { InsufficientMarginError, OrionisError } from "./errors.js";
import { createTrading } from "./trading.js";
import { addresses, fakeClient, NVDA, USER, WAD } from "./testing.js";

const MARK = 190n * WAD;
const SIG = `0x${"11".repeat(65)}` as const;

function setup(client = fakeClient().client) {
  return createTrading({
    client,
    addresses,
    chainId: 46630,
    decimals: async () => 6,
    oracle: {
      getIndexPrice: async () => ({ price: MARK, timestamp: 1n }),
      getMarkPrice: async () => ({ price: MARK, timestamp: 1n }),
      getLastPrice: async () => ({ price: MARK, timestamp: 1n }),
    },
  });
}

test("a deposit is an approve then a deposit, both aimed at the right contracts", async () => {
  const [approve, deposit] = await setup().prepareDeposit("1000");
  assert.equal(approve.to, addresses.settlementToken);
  const approval = decodeFunctionData({ abi: erc20Abi, data: approve.data }).args!;
  assert.equal(String(approval[0]).toLowerCase(), addresses.vault.toLowerCase());
  assert.equal(approval[1], 1_000_000_000n);
  assert.equal(deposit.to, addresses.vault);
  const deposited = decodeFunctionData({ abi: vaultAbi, data: deposit.data }).args!;
  assert.equal(String(deposited[0]).toLowerCase(), addresses.settlementToken.toLowerCase());
  assert.equal(deposited[1], 1_000_000_000n);
  assert.equal(approve.value, 0n);
  assert.equal(approve.chainId, 46630);
});

test("a withdrawal goes to the vault", async () => {
  const withdraw = await setup().prepareWithdraw("250.5");
  assert.equal(withdraw.to, addresses.vault);
  assert.equal(decodeFunctionData({ abi: vaultAbi, data: withdraw.data }).functionName, "withdraw");
  assert.equal(decodeFunctionData({ abi: vaultAbi, data: withdraw.data }).args![1], 250_500_000n);
});

test("opening a perp bounds the price by slippage from the mark, and by worstPrice when given", async () => {
  const trading = setup();
  const long = await trading.prepareOpenPerp({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, deadline: 2_000_000_000n });
  const args = decodeFunctionData({ abi: perpsEngineAbi, data: long.data }).args!;
  assert.deepEqual(args, [NVDA, true, 1_000_000_000n, 5n, (MARK * 10_050n) / 10_000n, 2_000_000_000n]);

  const short = await trading.prepareOpenPerp({ market: "NVDA", side: "SHORT", collateral: "1000", leverage: 5, slippageBps: 100, deadline: 2_000_000_000n });
  assert.equal(decodeFunctionData({ abi: perpsEngineAbi, data: short.data }).args![4], (MARK * 9_900n) / 10_000n, "a short entry is a lower bound");

  const explicit = await trading.prepareOpenPerp({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, worstPrice: "191.25", deadline: 2_000_000_000n });
  assert.equal(decodeFunctionData({ abi: perpsEngineAbi, data: explicit.data }).args![4], 191_250_000_000_000_000_000n);
});

test("closing a long uses a lower bound, and a short an upper bound", async () => {
  const trading = setup();
  const long = await trading.prepareClosePerp(9n, { market: "NVDA", side: "LONG", deadline: 2_000_000_000n });
  assert.equal(decodeFunctionData({ abi: perpsEngineAbi, data: long.data }).args![1], (MARK * 9_950n) / 10_000n);
  const short = await trading.prepareClosePerp(9n, { market: "NVDA", side: "SHORT", deadline: 2_000_000_000n });
  assert.equal(decodeFunctionData({ abi: perpsEngineAbi, data: short.data }).args![1], (MARK * 10_050n) / 10_000n);
});

test("increase and reduce carry the position, the amounts and the bound", async () => {
  const trading = setup();
  const increase = await trading.prepareIncreasePerp(3n, { market: "NVDA", side: "LONG", addCollateral: "100", addSize: "500", deadline: 2_000_000_000n });
  const decoded = decodeFunctionData({ abi: perpsEngineAbi, data: increase.data });
  assert.equal(decoded.functionName, "increasePosition");
  assert.deepEqual(decoded.args!.slice(0, 3), [3n, 100_000_000n, 500_000_000n]);
  const reduce = await trading.prepareReducePerp(3n, { market: "NVDA", side: "LONG", size: "200", deadline: 2_000_000_000n });
  assert.deepEqual(decodeFunctionData({ abi: perpsEngineAbi, data: reduce.data }).args!.slice(0, 2), [3n, 200_000_000n]);
});

test("limit and trigger orders, and their cancel and execute calls", async () => {
  const trading = setup();
  const limit = await trading.preparePlaceLimitOrder({ market: "NVDA", side: "SHORT", collateral: "1000", leverage: 2, triggerPrice: "195", expiry: 2_000_000_000n });
  assert.deepEqual(decodeFunctionData({ abi: perpsEngineAbi, data: limit.data }).args, [NVDA, false, 1_000_000_000n, 2n, 195n * WAD, 2_000_000_000n]);

  const trigger = trading.preparePlaceTriggerOrder({ positionId: 4n, kind: "TAKE_PROFIT", triggerPrice: "210", expiry: 2_000_000_000n });
  assert.deepEqual(decodeFunctionData({ abi: perpsEngineAbi, data: trigger.data }).args, [4n, 1, 210n * WAD, 2_000_000_000n]);
  assert.throws(() => trading.preparePlaceTriggerOrder({ positionId: 4n, kind: "TRAILING" as never, triggerPrice: "1" }), OrionisError);

  for (const [prepared, name] of [
    [trading.prepareCancelLimitOrder(5n), "cancelLimitOrder"],
    [trading.prepareExecuteLimitOrder(5n), "executeLimitOrder"],
    [trading.prepareCancelTriggerOrder(5n), "cancelTriggerOrder"],
    [trading.prepareExecuteTriggerOrder(5n), "executeTriggerOrder"],
  ] as const) {
    const decoded = decodeFunctionData({ abi: perpsEngineAbi, data: prepared.data });
    assert.equal(decoded.functionName, name);
    assert.deepEqual(decoded.args, [5n]);
    assert.equal(prepared.to, addresses.perpsEngine);
  }
});

test("option open and close carry the signed quote's premium and signature", async () => {
  const trading = setup();
  const authorization = { premium: 4_820_000_000n, validUntil: 1_900_000_000n, nonce: 7n, signature: SIG };
  const open = trading.prepareOpenOption({ underlying: "NVDA", type: "PUT", strike: "180", expiry: 1_900_100_000n, contracts: 10, authorization, deadline: 2_000_000_000n });
  const decoded = decodeFunctionData({ abi: optionsEngineAbi, data: open.data });
  assert.equal(decoded.functionName, "openPosition");
  const [params, quote] = decoded.args as unknown as [Record<string, unknown>, Record<string, unknown>];
  assert.equal(params.premium, 4_820_000_000n);
  assert.equal(params.contracts, 10n);
  assert.equal(params.strike, 180n * WAD);
  assert.equal(quote.signature, SIG);
  assert.equal(quote.nonce, 7n);

  const close = trading.prepareCloseOption({ positionId: 9n, authorization, deadline: 2_000_000_000n });
  assert.deepEqual(decodeFunctionData({ abi: optionsEngineAbi, data: close.data }).args!.slice(0, 3), [9n, 4_820_000_000n, 2_000_000_000n]);
});

test("bad input is rejected before any calldata is built", async () => {
  const trading = setup();
  await assert.rejects(trading.prepareOpenPerp({ market: "NVDA", side: "UP" as never, collateral: "1", leverage: 1 }), /side must be/);
  await assert.rejects(trading.prepareOpenPerp({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, slippageBps: 10_000 }), /slippageBps/);
  assert.throws(() => trading.prepareOpenOption({ underlying: "NVDA", type: "SWAP" as never, strike: "1", expiry: 1n, contracts: 1, authorization: { premium: 1n, validUntil: 1n, nonce: 1n, signature: SIG } }), /option type/);
});

test("simulate runs the call from the sender and maps a revert to a typed error", async () => {
  const calls: unknown[] = [];
  const ok = { call: async (params: unknown) => (calls.push(params), { data: "0x" }) } as never;
  const trading = setup(ok);
  const prepared = trading.prepareCancelLimitOrder(1n);
  await trading.simulate(prepared, USER);
  assert.deepEqual(calls[0], { account: USER, to: prepared.to, data: prepared.data });

  const failing = { call: async () => { throw new BaseError("boom"); } } as never;
  await assert.rejects(setup(failing).simulate(prepared, USER), BaseError, "an unrecognised error passes through unchanged");
  void InsufficientMarginError;
});

test("executing an RFQ quote is a call to the RFQ manager with the quote and the maker's signature", async () => {
  const quote = { user: USER, market: "NVDA", side: "SHORT" as const, collateral: 1_000_000_000n, leverage: 5, price: 190n * WAD, validUntil: 1_900_000_000n, nonce: 7n, signature: SIG };
  const prepared = setup().prepareExecuteRfq(quote);
  assert.equal(prepared.to, addresses.rfqManager);
  const decoded = decodeFunctionData({ abi: rfqManagerAbi, data: prepared.data });
  assert.equal(decoded.functionName, "execute");
  const [args, signature] = decoded.args as unknown as [Record<string, unknown>, string];
  assert.equal(args.isLong, false);
  assert.equal(args.price, 190n * WAD);
  assert.equal(args.marketId, NVDA);
  assert.equal(signature, SIG);
});
