import assert from "node:assert/strict";
import { test } from "node:test";
import { InsufficientMarginError, NotImplementedError, AlphaMarketsError, PositionLimitExceededError } from "./errors.js";
import { triggerFiresBelow } from "./orders.js";
import { createPerps, type PerpsDeps } from "./perps.js";
import { activeMarket, addresses, fakeClient, NVDA, revertError, USER, WAD } from "./testing.js";

const MARK = 184_480_000_000_000_000_000n; // 184.48, 18 decimals

function setup(reads: Record<string, unknown> = {}, market = activeMarket, deployed: PerpsDeps["addresses"] = addresses) {
  const fake = fakeClient({
    availableBalance: 2_000_000_000n,
    getPosition: { isLong: true, marketId: NVDA },
    ...reads,
  });
  const deps: PerpsDeps = {
    client: fake.client,
    addresses: deployed,
    decimals: async () => 6,
    markets: { list: async () => [market], get: async () => market, stats: async () => [] },
    oracle: {
      getIndexPrice: async () => ({ price: 184_420_000_000_000_000_000n, timestamp: 1n }),
      getMarkPrice: async () => ({ price: MARK, timestamp: 1n }),
      getLastPrice: async () => ({ price: MARK, timestamp: 1n }),
    },
    risk: {
      openInterest: async () => ({ long: 0n, short: 0n, total: 0n }),
      openInterestHistory: async () => [],
      get: async () => ({
        maxLeverage: 10n,
        allowedLeverageTiers: [1n, 2n, 3n, 5n, 10n],
        initialMarginRateBps: 1000n,
        maintenanceMarginRateBps: 500n,
        maxPositionNotional: 500_000n * WAD,
        openInterestCap: 5_000_000n * WAD,
      }),
    },
    fees: {
      get: async () => ({ makerFee: 2n, takerFee: 8n, optionOpenFee: 0n, optionCloseFee: 0n, settlementFee: 0n, liquidationFee: 0n }),
    },
    funding: {
      get: async () => ({ currentFundingRateBps: 8n, fundingIntervalSeconds: 3600n, nextFundingTimestamp: 99n }),
      history: async () => [],
    },
  };
  return { perps: createPerps(deps), ...fake };
}

test("previewOpen matches the brief's example: $1,000 at 5x, taker fee $4.00", async () => {
  const { perps } = setup();
  const preview = await perps.previewOpen({ market: "NVDA-PERP", side: "LONG", collateral: "1000", leverage: 5, user: USER });

  assert.equal(preview.collateral, 1_000_000_000n);
  assert.equal(preview.notional, 5_000_000_000n);
  assert.equal(preview.fee, 4_000_000n);
  assert.equal(preview.totalRequired, 1_004_000_000n);
  assert.equal(preview.entryPrice, MARK);
  // 5% maintenance margin on $5,000 = $250; equity buffer $750 -> 15% below entry.
  assert.equal(preview.liquidationPrice, 156_808_000_000_000_000_000n);
  assert.equal(preview.fundingRateBps, 8n);
  assert.equal(preview.sufficientCollateral, true);
  assert.deepEqual(preview.violations, []);
});

test("previewOpen reports insufficient Vault balance and onchain rule violations", async () => {
  const { perps } = setup({
    availableBalance: 500_000_000n,
    checkPositionSize: revertError("PositionLimitExceeded"),
    checkLeverage: revertError("InsufficientMargin"),
  });
  const preview = await perps.previewOpen({ market: "NVDA", side: "SHORT", collateral: "1000", leverage: 5, user: USER });

  assert.equal(preview.sufficientCollateral, false);
  assert.equal(preview.violations.length, 2);
  assert.ok(preview.violations.some((violation) => violation instanceof PositionLimitExceededError));
  assert.ok(preview.violations.some((violation) => violation instanceof InsufficientMarginError));
});

test("previewOpen flags a paused market", async () => {
  const { perps } = setup({}, { ...activeMarket, active: false });
  const preview = await perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "10", leverage: 1 });
  assert.equal(preview.violations[0]?.errorName, "MarketPaused");
  assert.equal(preview.availableBalance, undefined);
});

test("openPosition sends scaled collateral, leverage and a slippage-bounded price", async () => {
  const { perps, simulated } = setup();
  const { hash, positionId } = await perps.openPosition({
    market: "NVDA-PERP",
    side: "LONG",
    collateral: "1000",
    leverage: 5,
    deadline: 2_000_000_000n,
  });

  assert.equal(positionId, 42n);
  assert.match(hash, /^0x/);
  const [call] = simulated();
  assert.equal(call!.functionName, "openPosition");
  // 0.5% default slippage above mark for a long
  assert.deepEqual(call!.args, [NVDA, true, 1_000_000_000n, 5n, (MARK * 10_050n) / 10_000n, 2_000_000_000n]);
});

test("a short entry bound sits below mark; an explicit worstPrice wins", async () => {
  const short = setup();
  await short.perps.openPosition({ market: "NVDA", side: "SHORT", collateral: "1", leverage: 1, slippageBps: 100 });
  assert.equal(short.simulated()[0]!.args![4], (MARK * 9_900n) / 10_000n);

  const explicit = setup();
  await explicit.perps.openPosition({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, worstPrice: "200" });
  assert.equal(explicit.simulated()[0]!.args![4], 200n * WAD);
});

test("openPosition points a LIMIT order at placeLimitOrder before any RPC call", async () => {
  const { perps, calls } = setup();
  await assert.rejects(
    perps.openPosition({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, orderType: "LIMIT" }),
    /placeLimitOrder/,
  );
  assert.equal(calls.length, 0);
});

test("a LIMIT preview needs a trigger and works out its figures at that price", async () => {
  const { perps } = setup();
  await assert.rejects(
    perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, orderType: "LIMIT" }),
    AlphaMarketsError,
  );

  const preview = await perps.previewOpen({ market: "NVDA", side: "LONG", collateral: "1000", leverage: 5, orderType: "LIMIT", limitPrice: "180" });
  assert.equal(preview.entryPrice, 180n * WAD);
  // 15% below the 180 trigger, not below the 184.48 mark.
  assert.equal(preview.liquidationPrice, 153n * WAD);
  assert.equal(preview.fee, 4_000_000n);
});

const order = (overrides: Record<string, unknown> = {}) => ({
  marketId: NVDA,
  isLong: true,
  collateral: 1_000_000_000n,
  leverage: 5n,
  triggerPrice: 180n * WAD,
  expiry: 2_000_000_000n,
  owner: USER,
  status: 0,
  positionId: 0n,
  ...overrides,
});

test("placeLimitOrder sends the trigger, expiry and side to the engine", async () => {
  const { perps, simulated } = setup();
  const { orderId } = await perps.placeLimitOrder({
    market: "NVDA",
    side: "SHORT",
    collateral: "1000",
    leverage: 5,
    limitPrice: "195.5",
    expiry: 2_000_000_000n,
  });

  assert.equal(orderId, 42n);
  const call = simulated()[0]!;
  assert.equal(call.functionName, "placeLimitOrder");
  assert.deepEqual(call.args, [NVDA, false, 1_000_000_000n, 5n, 195_500_000_000_000_000_000n, 2_000_000_000n]);
});

test("limit orders are unavailable on a deployment without a PerpOrderManager", async () => {
  const bare = new Proxy(addresses, { get: (target, key) => (key === "perpOrderManager" ? undefined : target[key as keyof typeof target]) });
  const { perps } = setup({}, activeMarket, bare);
  await assert.rejects(perps.placeLimitOrder({ market: "NVDA", side: "LONG", collateral: "1", leverage: 1, limitPrice: "1" }), NotImplementedError);
});

test("cancel and execute go to the engine; getOrder decodes the status", async () => {
  const { perps, simulated } = setup({ getOrder: order({ status: 1, positionId: 7n }) });
  await perps.cancelLimitOrder(3n);
  const { positionId } = await perps.executeLimitOrder(4n);

  assert.equal(positionId, 42n);
  assert.deepEqual(simulated().map((call) => [call.functionName, call.args]), [
    ["cancelLimitOrder", [3n]],
    ["executeLimitOrder", [4n]],
  ]);
  const read = await perps.getOrder(9n);
  assert.equal(read.status, "EXECUTED");
  assert.equal(read.positionId, 7n);
  assert.equal(read.id, 9n);
});

test("scanOrders reads every order from the given id up to the newest", async () => {
  const { perps, calls } = setup({ nextOrderId: 3n, getOrder: order() });
  const orders = await perps.scanOrders(2n);
  assert.deepEqual(orders.map((o) => o.id), [2n, 3n]);
  assert.equal(calls.filter((c) => c.functionName === "getOrder").length, 2);
});

const triggerOrder = (overrides: Record<string, unknown> = {}) => ({
  positionId: 5n,
  kind: 0,
  triggerPrice: 170n * WAD,
  expiry: 2_000_000_000n,
  owner: USER,
  status: 0,
  ...overrides,
});

test("placeTriggerOrder sends the position, kind, trigger and expiry to the engine", async () => {
  const { perps, simulated } = setup();
  const { orderId } = await perps.placeTriggerOrder({
    positionId: 5n,
    kind: "TAKE_PROFIT",
    triggerPrice: "210.25",
    expiry: 2_000_000_000n,
  });

  assert.equal(orderId, 42n);
  const call = simulated()[0]!;
  assert.equal(call.functionName, "placeTriggerOrder");
  assert.deepEqual(call.args, [5n, 1, 210_250_000_000_000_000_000n, 2_000_000_000n]);
});

test("placeTriggerOrder rejects an unknown kind before any RPC call", async () => {
  const { perps, simulated } = setup();
  await assert.rejects(
    perps.placeTriggerOrder({ positionId: 5n, kind: "TRAILING" as never, triggerPrice: "1" }),
    AlphaMarketsError,
  );
  assert.equal(simulated().length, 0);
});

test("trigger orders are unavailable on a deployment without a PerpOrderManager", async () => {
  const bare = new Proxy(addresses, { get: (target, key) => (key === "perpOrderManager" ? undefined : target[key as keyof typeof target]) });
  const { perps } = setup({}, activeMarket, bare);
  await assert.rejects(perps.placeTriggerOrder({ positionId: 1n, kind: "STOP_LOSS", triggerPrice: "1" }), NotImplementedError);
  assert.deepEqual(await perps.triggerOrders(USER), []);
});

test("trigger orders are refused on a deployment whose order manager predates them", async () => {
  const { perps, simulated } = setup({ nextTriggerOrderId: new Error("execution reverted") });
  assert.equal(await perps.supportsTriggerOrders(), false);
  await assert.rejects(perps.placeTriggerOrder({ positionId: 1n, kind: "STOP_LOSS", triggerPrice: "1" }), NotImplementedError);
  assert.equal(simulated().length, 0, "nothing is simulated or sent");
});

test("supportsTriggerOrders is true once the order manager answers, and remembered", async () => {
  const { perps, calls } = setup({ nextTriggerOrderId: 0n });
  assert.equal(await perps.supportsTriggerOrders(), true);
  assert.equal(await perps.supportsTriggerOrders(), true);
  assert.equal(calls.filter((c) => c.functionName === "nextTriggerOrderId").length, 1);
});

test("cancel and execute a trigger order go to the engine; getTriggerOrder decodes it", async () => {
  const { perps, simulated } = setup({ getTriggerOrder: triggerOrder({ kind: 1, status: 1 }) });
  await perps.cancelTriggerOrder(3n);
  await perps.executeTriggerOrder(4n);
  assert.deepEqual(simulated().map((call) => [call.functionName, call.args]), [
    ["cancelTriggerOrder", [3n]],
    ["executeTriggerOrder", [4n]],
  ]);

  const read = await perps.getTriggerOrder(9n);
  assert.equal(read.id, 9n);
  assert.equal(read.kind, "TAKE_PROFIT");
  assert.equal(read.status, "EXECUTED");
  assert.equal(read.positionId, 5n);
});

test("scanTriggerOrders reads every trigger order from the given id up to the newest", async () => {
  const { perps, calls } = setup({ nextTriggerOrderId: 3n, getTriggerOrder: triggerOrder() });
  const orders = await perps.scanTriggerOrders(2n);
  assert.deepEqual(orders.map((o) => o.id), [2n, 3n]);
  assert.equal(calls.filter((c) => c.functionName === "getTriggerOrder").length, 2);
});

test("a trigger fires below the mark for a long's stop-loss and a short's take-profit", () => {
  assert.equal(triggerFiresBelow(true, "STOP_LOSS"), true);
  assert.equal(triggerFiresBelow(true, "TAKE_PROFIT"), false);
  assert.equal(triggerFiresBelow(false, "STOP_LOSS"), false);
  assert.equal(triggerFiresBelow(false, "TAKE_PROFIT"), true);
});

test("closing a long uses a lower-bound exit price; a short uses an upper bound", async () => {
  const long = setup();
  await long.perps.closePosition(1n, { deadline: 2_000_000_000n });
  const [closeLong] = long.simulated();
  assert.equal(closeLong!.functionName, "closePosition");
  assert.equal(closeLong!.args![1], (MARK * 9_950n) / 10_000n);

  const short = setup({ getPosition: { isLong: false, marketId: NVDA } });
  await short.perps.closePosition(1n, { deadline: 2_000_000_000n });
  assert.equal(short.simulated()[0]!.args![1], (MARK * 10_050n) / 10_000n);
});

test("increase and reduce scale sizes by settlement decimals", async () => {
  const { perps, simulated } = setup();
  await perps.increasePosition(3n, { addCollateral: "100", addSize: "500", deadline: 2_000_000_000n });
  await perps.reducePosition(3n, { size: "250", deadline: 2_000_000_000n });

  const [increase, reduce] = simulated();
  assert.deepEqual(increase!.args!.slice(0, 3), [3n, 100_000_000n, 500_000_000n]);
  assert.deepEqual(reduce!.args!.slice(0, 2), [3n, 250_000_000n]);
});

test("list returns only active perp markets", async () => {
  const { perps } = setup();
  assert.equal((await perps.list()).length, 1);
  const paused = setup({}, { ...activeMarket, perpsEnabled: false });
  assert.equal((await paused.perps.list()).length, 0);
});
