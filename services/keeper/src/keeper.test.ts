import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenOrder, AlphaMarkets, TriggerOrder } from "@alphamarkets/sdk";
import type { PublicClient, WalletClient } from "viem";
import { createKeeper } from "./keeper.js";

const WAD = 10n ** 18n;
const ME = `0x${"aa".repeat(20)}` as const;
const FEED = `0x${"fe".repeat(20)}` as const;
const MARKET = `0x${"11".repeat(32)}` as const;

const order = (id: bigint, overrides: Partial<OpenOrder> = {}): OpenOrder => ({
  id,
  marketId: MARKET,
  isLong: true,
  collateral: 1_000n,
  leverage: 5n,
  triggerPrice: 180n * WAD,
  expiry: 9_999n,
  owner: `0x${"01".repeat(20)}`,
  status: "OPEN",
  positionId: 0n,
  ...overrides,
});

const triggerOrder = (id: bigint, overrides: Partial<TriggerOrder> = {}): TriggerOrder => ({
  id,
  positionId: 5n,
  kind: "STOP_LOSS",
  triggerPrice: 180n * WAD,
  expiry: 9_999n,
  owner: `0x${"01".repeat(20)}`,
  status: "OPEN",
  ...overrides,
});

/// `open: false` marks the position of every trigger order as already closed.
function setup({ orders = [] as OpenOrder[], triggers = [] as TriggerOrder[], triggerSupport = true, open = true, isLong = true, mark = 190n * WAD, feedOwner = ME, feedAge = 100n, now = 5_000n, withOrders = true } = {}) {
  const executed: bigint[] = [];
  const fired: bigint[] = [];
  const scans: bigint[] = [];
  const triggerScans: bigint[] = [];
  const writes: string[] = [];
  const logs: string[] = [];
  const simulatedWith: unknown[] = [];

  const alphaMarkets = {
    addresses: { oracleRouter: `0x${"0e".repeat(20)}`, ...(withOrders ? { perpOrderManager: `0x${"0f".repeat(20)}` } : {}) },
    markets: { list: async () => [{ marketId: MARKET, oracleId: MARKET, active: true }] },
    oracle: { getMarkPrice: async () => ({ price: mark, timestamp: 1n }) },
    perps: {
      scanOrders: async (from: bigint) => {
        scans.push(from);
        return orders.filter((o) => o.id >= from);
      },
      executeLimitOrder: async (id: bigint) => {
        if (id === 99n) throw new Error("InsufficientCollateral()\nmore detail");
        executed.push(id);
        return { hash: "0xhash", positionId: 7n };
      },
      supportsTriggerOrders: async () => triggerSupport,
      scanTriggerOrders: async (from: bigint) => {
        triggerScans.push(from);
        return triggers.filter((o) => o.id >= from);
      },
      executeTriggerOrder: async (id: bigint) => {
        if (id === 99n) throw new Error("PositionNotOpen()\nmore detail");
        fired.push(id);
        return "0xfired";
      },
    },
    portfolio: { getPerpPosition: async () => ({ open, isLong, marketId: MARKET }) },
  } as unknown as AlphaMarkets;

  const publicClient = {
    getBlock: async () => ({ timestamp: now }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "primarySource") return FEED;
      if (functionName === "owner") return feedOwner;
      if (functionName === "latestPrice") return [190n * WAD, now - feedAge];
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async ({ functionName, account }: { functionName: string; account: unknown }) => {
      simulatedWith.push(account);
      return { request: { functionName, account } };
    },
    waitForTransactionReceipt: async () => ({}),
  } as unknown as PublicClient;
  const signer = { address: ME, type: "local" };
  const walletClient = {
    account: signer,
    writeContract: async (request: { functionName: string }) => (writes.push(request.functionName), "0xwrite"),
  } as unknown as WalletClient;

  const keeper = createKeeper({
    alphaMarkets,
    publicClient,
    walletClient,
    refreshSeconds: 1_800n,
    refreshFeeds: true,
    log: (message) => logs.push(message),
  });
  return { keeper, executed, fired, scans, triggerScans, writes, logs, signer, simulatedWith };
}

test("fills an order whose trigger is reached and leaves the rest", async () => {
  const { keeper, executed } = setup({ orders: [order(1n), order(2n, { triggerPrice: 150n * WAD })], mark: 179n * WAD });
  const result = await keeper.tick();
  assert.deepEqual(executed, [1n]);
  assert.equal(result.filled, 1);
});

test("a failing fill is logged and does not stop the others", async () => {
  const { keeper, executed, logs } = setup({ orders: [order(99n), order(100n)], mark: 170n * WAD });
  await keeper.tick();
  assert.deepEqual(executed, [100n]);
  assert.ok(logs.some((line) => line.includes("order 99n") || line.includes("order 99")), logs.join("|"));
});

test("skips finished orders and does not rescan them", async () => {
  const { keeper, scans } = setup({ orders: [order(1n, { status: "EXECUTED" }), order(2n, { status: "CANCELLED" }), order(3n)], mark: 190n * WAD });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(scans, [1n, 3n]);
});

test("refreshes a feed it owns once it is old, and leaves a fresh or foreign one alone", async () => {
  const stale = setup({ feedAge: 2_000n });
  assert.equal((await stale.keeper.tick()).refreshed, 1);
  assert.deepEqual(stale.writes, ["setPrice"]);
  // The write must be signed by the keeper's own account, not sent for the node to sign with an
  // address it does not hold.
  assert.deepEqual(stale.simulatedWith, [stale.signer]);

  const fresh = setup({ feedAge: 60n });
  assert.equal((await fresh.keeper.tick()).refreshed, 0);

  const foreign = setup({ feedAge: 2_000n, feedOwner: `0x${"bb".repeat(20)}` });
  assert.equal((await foreign.keeper.tick()).refreshed, 0);
  assert.deepEqual(foreign.writes, []);
});

test("without an order manager the keeper only refreshes feeds", async () => {
  const { keeper, scans } = setup({ withOrders: false, feedAge: 2_000n });
  const result = await keeper.tick();
  assert.deepEqual(result, { refreshed: 1, filled: 0, triggered: 0 });
  assert.deepEqual(scans, []);
});

test("a wallet client without an account is rejected up front", () => {
  assert.throws(
    () =>
      createKeeper({
        alphaMarkets: {} as AlphaMarkets,
        publicClient: {} as PublicClient,
        walletClient: {} as WalletClient,
        refreshSeconds: 1n,
        refreshFeeds: true,
      }),
    /needs an account/,
  );
});

test("a failed read is logged with viem's short message", async () => {
  const { keeper, logs } = setup({ orders: [order(1n)] });
  // Make the mark price read fail the way viem reports a revert.
  const failing = createKeeper({
    alphaMarkets: {
      addresses: { oracleRouter: `0x${"0e".repeat(20)}`, perpOrderManager: `0x${"0f".repeat(20)}` },
      markets: { list: async () => [] },
      oracle: { getMarkPrice: async () => Promise.reject(Object.assign(new Error("long\nmultiline"), { shortMessage: "The contract function reverted" })) },
      perps: { scanOrders: async () => [order(1n)] },
    } as unknown as AlphaMarkets,
    publicClient: { getBlock: async () => ({ timestamp: 5_000n }) } as unknown as PublicClient,
    walletClient: { account: { address: ME } } as unknown as WalletClient,
    refreshSeconds: 1_800n,
    refreshFeeds: false,
    log: (message) => logs.push(message),
  });
  await failing.tick();
  assert.ok(logs.some((line) => line.includes("order 1 not filled: The contract function reverted")), logs.join("|"));
  void keeper;
});

test("fires a stop-loss whose trigger is reached and leaves the rest", async () => {
  const { keeper, fired } = setup({
    triggers: [triggerOrder(1n), triggerOrder(2n, { triggerPrice: 150n * WAD }), triggerOrder(3n, { kind: "TAKE_PROFIT", triggerPrice: 200n * WAD })],
    mark: 179n * WAD,
  });
  const result = await keeper.tick();
  assert.deepEqual(fired, [1n]);
  assert.equal(result.triggered, 1);
});

test("a short's stop-loss fires as the mark rises, its take-profit as it falls", async () => {
  const stop = setup({ isLong: false, triggers: [triggerOrder(1n, { triggerPrice: 200n * WAD })], mark: 201n * WAD });
  await stop.keeper.tick();
  assert.deepEqual(stop.fired, [1n]);

  const profit = setup({ isLong: false, triggers: [triggerOrder(1n, { kind: "TAKE_PROFIT", triggerPrice: 170n * WAD })], mark: 171n * WAD });
  await profit.keeper.tick();
  assert.deepEqual(profit.fired, [], "not reached yet");
});

test("a trigger order on a closed position is never fired and is scanned past", async () => {
  const { keeper, fired, triggerScans } = setup({ open: false, triggers: [triggerOrder(1n), triggerOrder(2n)], mark: 170n * WAD });
  await keeper.tick();
  await keeper.tick();
  assert.deepEqual(fired, []);
  assert.deepEqual(triggerScans, [1n, 3n], "the second scan starts past the dead orders");
});

test("a failing trigger is logged and does not stop the others", async () => {
  const { keeper, fired, logs } = setup({ triggers: [triggerOrder(99n), triggerOrder(100n)], mark: 170n * WAD });
  await keeper.tick();
  assert.deepEqual(fired, [100n]);
  assert.ok(logs.some((line) => line.includes("trigger order 99 not fired")), logs.join("|"));
});

test("a failing trigger scan does not hide the feed refresh or the limit fills", async () => {
  const failing = createKeeper({
    alphaMarkets: {
      addresses: { oracleRouter: `0x${"0e".repeat(20)}`, perpOrderManager: `0x${"0f".repeat(20)}` },
      markets: { list: async () => [] },
      oracle: { getMarkPrice: async () => ({ price: 170n * WAD, timestamp: 1n }) },
      perps: {
        scanOrders: async () => [order(1n)],
        executeLimitOrder: async () => ({ hash: "0xhash", positionId: 7n }),
        supportsTriggerOrders: async () => true,
        scanTriggerOrders: async () => Promise.reject(new Error("rpc down")),
      },
    } as unknown as AlphaMarkets,
    publicClient: { getBlock: async () => ({ timestamp: 5_000n }) } as unknown as PublicClient,
    walletClient: { account: { address: ME } } as unknown as WalletClient,
    refreshSeconds: 1_800n,
    refreshFeeds: false,
    log: () => {},
  });
  assert.deepEqual(await failing.tick(), { refreshed: 0, filled: 1, triggered: 0 });
});

test("on a deployment without trigger orders the keeper still fills limit orders and scans no triggers", async () => {
  const { keeper, executed, triggerScans } = setup({ orders: [order(1n)], triggers: [triggerOrder(1n)], triggerSupport: false, mark: 170n * WAD });
  const result = await keeper.tick();
  assert.deepEqual(executed, [1n]);
  assert.deepEqual(triggerScans, []);
  assert.deepEqual(result, { refreshed: 0, filled: 1, triggered: 0 });
});
