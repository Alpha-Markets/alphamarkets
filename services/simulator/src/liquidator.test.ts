import assert from "node:assert/strict";
import { test } from "node:test";
import type { AlphaMarkets } from "@alphamarkets/sdk";
import type { Address, PublicClient, WalletClient } from "viem";
import { createLiquidator } from "./liquidator.js";

const ME = "0x00000000000000000000000000000000000000aa" as Address;
const ENGINE = "0x00000000000000000000000000000000000000ee" as Address;
const WATCHED = "0x00000000000000000000000000000000000000bb" as Address;
const marketId = `0x${Buffer.from("NVDA").toString("hex").padEnd(64, "0")}` as `0x${string}`;

function fake(liquidatable: bigint[], extraPositions: bigint[] = []) {
  const calls = { reads: [] as bigint[], liquidated: [] as bigint[], portfolioReads: 0, logs: [] as string[] };
  const publicClient = {
    readContract: async ({ args }: { args: readonly [bigint] }) => {
      calls.reads.push(args[0]);
      return liquidatable.includes(args[0]);
    },
    simulateContract: async ({ args }: { args: readonly [bigint] }) => ({ request: { id: args[0] } }),
    waitForTransactionReceipt: async () => ({}),
  } as unknown as PublicClient;
  const walletClient = {
    account: { address: ME },
    writeContract: async (request: { id: bigint }) => {
      calls.liquidated.push(request.id);
      return `0x${"1".padStart(64, "0")}` as `0x${string}`;
    },
  } as unknown as WalletClient;
  const alphaMarkets = {
    portfolio: {
      positions: async () => {
        calls.portfolioReads++;
        return { options: [], perps: extraPositions.map((positionId) => ({ positionId, open: true })) };
      },
      getPerpPosition: async (id: bigint) => ({ positionId: id, marketId, isLong: true, owner: WATCHED }),
    },
  } as unknown as AlphaMarkets;
  return { calls, publicClient, walletClient, alphaMarkets };
}

test("it checks the positions the bots know about, and liquidates only the ones under margin", async () => {
  const { calls, publicClient, walletClient, alphaMarkets } = fake([2n]);
  const book = new Set([1n, 2n, 3n]);
  const liquidator = createLiquidator({ alphaMarkets, publicClient, walletClient, engine: ENGINE, book, wallets: () => [], log: (m) => calls.logs.push(m) });
  assert.equal(await liquidator.tick(), 1);
  assert.deepEqual(calls.reads.sort(), [1n, 2n, 3n]);
  assert.deepEqual(calls.liquidated, [2n]);
  assert.deepEqual([...book].sort(), [1n, 3n], "a liquidated position leaves the book");
  assert.ok(calls.logs.some((line) => line.includes("LIQUIDATED LONG NVDA #2")));
  assert.equal(calls.portfolioReads, 0, "no portfolio is read for wallets the bots track");
});

test("wallets outside the bots are read only every few rounds", async () => {
  const { calls, publicClient, walletClient, alphaMarkets } = fake([], [9n]);
  const liquidator = createLiquidator({ alphaMarkets, publicClient, walletClient, engine: ENGINE, book: new Set(), wallets: () => [WATCHED], walletEvery: 3, log: () => {} });
  for (let i = 0; i < 6; i++) await liquidator.tick();
  assert.equal(calls.portfolioReads, 2, "rounds 1 and 4 read the wallet");
  assert.equal(calls.reads.filter((id) => id === 9n).length, 2, "and the position it found is checked in those rounds");
});

test("a failed check is logged and does not stop the round", async () => {
  const { calls, publicClient, walletClient, alphaMarkets } = fake([]);
  (publicClient as unknown as { readContract: unknown }).readContract = async ({ args }: { args: readonly [bigint] }) => {
    if (args[0] === 1n) throw new Error("HTTP request failed.");
    calls.reads.push(args[0]);
    return false;
  };
  const liquidator = createLiquidator({ alphaMarkets, publicClient, walletClient, engine: ENGINE, book: new Set([1n, 2n]), wallets: () => [], log: (m) => calls.logs.push(m) });
  assert.equal(await liquidator.tick(), 0);
  assert.deepEqual(calls.reads, [2n]);
  assert.ok(calls.logs.some((line) => line.includes("could not liquidate #1: HTTP request failed.")));
});
