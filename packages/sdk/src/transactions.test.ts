import assert from "node:assert/strict";
import { test } from "node:test";
import { BaseError, encodeErrorResult } from "viem";
import { allErrorsAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { InsufficientCollateralError } from "./errors.js";
import { executeTx, type TxEvent } from "./transactions.js";

const HASH = `0x${"ab".repeat(32)}` as const;

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    writeContract: async () => HASH,
    waitForTransactionReceipt: async () => ({ status: "success" }),
    ...overrides,
  } as unknown as OrionisClient;
}

const simulate = async () => ({ request: {}, result: 7n });

test("emits preparing -> awaiting_wallet -> submitted and returns without waiting by default", async () => {
  const events: string[] = [];
  const out = await executeTx(fakeClient(), simulate, { onStatus: (event) => events.push(event.status) });
  assert.deepEqual(events, ["preparing", "awaiting_wallet", "submitted"]);
  assert.equal(out.hash, HASH);
  assert.equal(out.result, 7n);
  assert.equal(out.receipt, undefined);
});

test("wait: true also emits confirming -> confirmed with the receipt", async () => {
  const events: TxEvent[] = [];
  const out = await executeTx(fakeClient(), simulate, { wait: true, onStatus: (event) => events.push(event) });
  assert.deepEqual(
    events.map((event) => event.status),
    ["preparing", "awaiting_wallet", "submitted", "confirming", "confirmed"],
  );
  assert.equal(events.at(-1)?.hash, HASH);
  assert.equal(out.receipt?.status, "success");
});

test("a reverted receipt emits failed and throws", async () => {
  const events: string[] = [];
  const client = fakeClient({ waitForTransactionReceipt: async () => ({ status: "reverted" }) });
  await assert.rejects(
    executeTx(client, simulate, { wait: true, onStatus: (event) => events.push(event.status) }),
    /reverted onchain/,
  );
  assert.equal(events.at(-1), "failed");
});

test("a simulation revert is decoded to a typed error before the wallet is asked", async () => {
  let walletCalled = false;
  const data = encodeErrorResult({ abi: allErrorsAbi, errorName: "InsufficientCollateral" });
  const client = fakeClient({
    writeContract: async () => {
      walletCalled = true;
      return HASH;
    },
  });
  const events: TxEvent[] = [];
  await assert.rejects(
    executeTx(
      client,
      async () => {
        throw new BaseError("simulate failed", { cause: Object.assign(new Error("reverted"), { data }) });
      },
      { onStatus: (event) => events.push(event) },
    ),
    InsufficientCollateralError,
  );
  assert.equal(walletCalled, false);
  assert.deepEqual(
    events.map((event) => event.status),
    ["preparing", "failed"],
  );
  assert.ok(events[1]!.error instanceof InsufficientCollateralError);
});

test("a throwing status listener cannot abort the transaction", async () => {
  const out = await executeTx(fakeClient(), simulate, {
    onStatus: () => {
      throw new Error("ui bug");
    },
  });
  assert.equal(out.hash, HASH);
});
