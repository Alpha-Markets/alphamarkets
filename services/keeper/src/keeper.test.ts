import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenOrder, Orionis } from "@orionis/sdk";
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

function setup({ orders = [] as OpenOrder[], mark = 190n * WAD, feedOwner = ME, feedAge = 100n, now = 5_000n, withOrders = true } = {}) {
  const executed: bigint[] = [];
  const scans: bigint[] = [];
  const writes: string[] = [];
  const logs: string[] = [];
  const simulatedWith: unknown[] = [];

  const orionis = {
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
    },
  } as unknown as Orionis;

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
    orionis,
    publicClient,
    walletClient,
    refreshSeconds: 1_800n,
    refreshFeeds: true,
    log: (message) => logs.push(message),
  });
  return { keeper, executed, scans, writes, logs, signer, simulatedWith };
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
  assert.deepEqual(result, { refreshed: 1, filled: 0 });
  assert.deepEqual(scans, []);
});

test("a wallet client without an account is rejected up front", () => {
  assert.throws(
    () =>
      createKeeper({
        orionis: {} as Orionis,
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
    orionis: {
      addresses: { oracleRouter: `0x${"0e".repeat(20)}`, perpOrderManager: `0x${"0f".repeat(20)}` },
      markets: { list: async () => [] },
      oracle: { getMarkPrice: async () => Promise.reject(Object.assign(new Error("long\nmultiline"), { shortMessage: "The contract function reverted" })) },
      perps: { scanOrders: async () => [order(1n)] },
    } as unknown as Orionis,
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
