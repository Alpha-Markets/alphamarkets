import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Address, PublicClient, WalletClient } from "viem";
import { createPriceDriver } from "./driver.js";
import { createRng } from "./prng.js";
import { toFeedPrice } from "./priceModel.js";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const SYMBOLS = ["NVDA", "TSLA", "AAPL"];
const START: Record<string, number> = { NVDA: 190, TSLA: 350, AAPL: 230 };
const idOf = (symbol: string) => `0x${Buffer.from(symbol).toString("hex").padEnd(64, "0")}` as `0x${string}`;
const feedOf = (symbol: string) => `0x${Buffer.from(symbol).toString("hex").padStart(40, "0")}` as Address;

/// A chain that answers the few reads the driver makes, and records what it is asked to send.
function fakeChain(options: { owner?: Address; failOn?: string } = {}) {
  const sent: Array<{ symbol: string; price: bigint; nonce: number }> = [];
  const state = { nonceReads: 0, chainNonce: 100, failOn: options.failOn };
  const symbolOfFeed = (feed: Address) => SYMBOLS.find((s) => feedOf(s).toLowerCase() === feed.toLowerCase())!;

  const publicClient = {
    readContract: async ({ functionName, args, address }: { functionName: string; args?: readonly unknown[]; address: Address }) => {
      if (functionName === "primarySource") return feedOf(SYMBOLS.find((s) => idOf(s) === args![0])!);
      if (functionName === "owner") return options.owner ?? OWNER;
      if (functionName === "latestPrice") return [toFeedPrice(START[symbolOfFeed(address)]!), 0n];
      throw new Error(`unexpected read ${functionName}`);
    },
    getTransactionCount: async () => {
      state.nonceReads++;
      return state.chainNonce;
    },
    waitForTransactionReceipt: async () => ({}),
  } as unknown as PublicClient;

  const walletClient = {
    account: { address: OWNER },
    chain: undefined,
    writeContract: async ({ address, args, nonce }: { address: Address; args: readonly [bigint]; nonce: number }) => {
      const symbol = symbolOfFeed(address);
      if (state.failOn === symbol) throw new Error("RPC Request failed.");
      sent.push({ symbol, price: args[0], nonce });
      return `0x${sent.length.toString(16).padStart(64, "0")}` as `0x${string}`;
    },
  } as unknown as WalletClient;

  return { publicClient, walletClient, sent, state };
}

async function driverFor(chain: ReturnType<typeof fakeChain>, volatility = 20) {
  const dir = mkdtempSync(join(tmpdir(), "sim-driver-"));
  const logs: string[] = [];
  const driver = await createPriceDriver({
    publicClient: chain.publicClient,
    walletClient: chain.walletClient,
    router: OWNER,
    marketIds: SYMBOLS.map((symbol) => ({ symbol, marketId: idOf(symbol) })),
    stateDir: dir,
    rng: createRng(3),
    volatility,
    tickMs: 1_000,
    log: (message) => logs.push(message),
  });
  return { driver, logs, cleanup: () => rmSync(dir, { recursive: true }) };
}

test("a step sends every changed price at once, on consecutive nonces from the chain", async () => {
  const chain = fakeChain();
  const { driver, cleanup } = await driverFor(chain);
  try {
    await driver.tick();
    assert.equal(chain.sent.length, 3);
    assert.deepEqual(chain.sent.map((tx) => tx.nonce), [100, 101, 102]);
    assert.equal(chain.state.nonceReads, 1);
    await driver.tick();
    // The next step goes on from the last nonce it used and does not ask the chain again.
    assert.ok(chain.sent.slice(3).every((tx, i) => tx.nonce === 103 + i));
    assert.equal(chain.state.nonceReads, 1);
  } finally {
    cleanup();
  }
});

test("a market whose price did not change is not sent", async () => {
  const chain = fakeChain();
  const { driver, cleanup } = await driverFor(chain, 0); // no volatility: prices stay put
  try {
    await driver.tick();
    assert.equal(chain.sent.length, 0);
  } finally {
    cleanup();
  }
});

test("after a failed send, the next step reads the nonce from the chain again", async () => {
  const chain = fakeChain({ failOn: "TSLA" });
  const { driver, logs, cleanup } = await driverFor(chain);
  try {
    await driver.tick();
    assert.ok(logs.some((line) => line.includes("could not push TSLA")));
    assert.equal(chain.state.nonceReads, 1);
    chain.state.failOn = undefined;
    chain.state.chainNonce = 102;
    await driver.tick();
    assert.equal(chain.state.nonceReads, 2);
    // It goes on from the chain's count, not from the nonces the failed step reserved.
    assert.deepEqual(chain.sent.slice(-3).map((tx) => tx.nonce), [102, 103, 104]);
  } finally {
    cleanup();
  }
});

test("a wallet that does not own the feeds is refused with a clear message", async () => {
  const chain = fakeChain({ owner: "0x00000000000000000000000000000000000000bb" });
  await assert.rejects(driverFor(chain), /does not own the NVDA feed/);
});
