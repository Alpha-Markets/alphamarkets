import assert from "node:assert/strict";
import { test } from "node:test";
import { createSubaccounts } from "./accounts.js";
import { NotImplementedError } from "./errors.js";
import type { PreparedTx } from "./trading.js";
import { addresses, addressesWithout, fakeClient, USER } from "./testing.js";

const SUB = `0x${"5a".repeat(20)}` as const;
const call: PreparedTx = { to: `0x${"0f".repeat(20)}`, data: "0x1234", value: 0n, chainId: 1, description: "x" };

function setup(deployed = addresses, reads: Record<string, unknown> = {}) {
  const fake = fakeClient({ computeAddress: SUB, subaccountsOf: [SUB], index: 3n, isDelegate: true, ...reads });
  const approvals: Array<[string, string, unknown]> = [];
  const subaccounts = createSubaccounts({
    client: fake.client,
    addresses: deployed,
    vault: { balances: async () => ({ balance: 5n, lockedMargin: 2n, available: 3n }) } as never,
    erc20: { approve: async (token: string, spender: string, amount: unknown) => (approvals.push([token, spender, amount]), "0xhash") } as never,
    decimals: async () => 6,
  });
  return { subaccounts, approvals, ...fake };
}

test("without a factory every method says so", async () => {
  const { subaccounts } = setup(addressesWithout("subaccountFactory"));
  assert.equal(subaccounts.supported(), false);
  await assert.rejects(subaccounts.computeAddress(USER, 1n), NotImplementedError);
  await assert.rejects(subaccounts.list(USER), NotImplementedError);
});

test("list returns each subaccount with its index, and computeAddress reads the factory", async () => {
  const { subaccounts } = setup();
  assert.equal(await subaccounts.computeAddress(USER, 3n), SUB);
  assert.deepEqual(await subaccounts.list(USER), [{ address: SUB, index: 3n }]);
  assert.equal(await subaccounts.isDelegate(SUB, USER), true);
  assert.deepEqual(await subaccounts.balances(SUB), { balance: 5n, lockedMargin: 2n, available: 3n });
});

test("a deposit approves the subaccount for the token, then deposits into it", async () => {
  const { subaccounts, approvals, simulated } = setup();
  await subaccounts.deposit(SUB, "250.5");
  assert.deepEqual(approvals, [[addresses.settlementToken, SUB, 250_500_000n]]);
  const deposit = simulated()[0]!;
  assert.equal(deposit.functionName, "deposit");
  assert.deepEqual(deposit.args, [addresses.settlementToken, 250_500_000n]);
});

test("withdraw, delegate, execute and multicall go to the subaccount", async () => {
  const { subaccounts, simulated } = setup();
  await subaccounts.withdraw(SUB, "10");
  await subaccounts.setDelegate(SUB, USER, true);
  await subaccounts.execute(SUB, call);
  await subaccounts.multicall(SUB, [call, call]);
  assert.deepEqual(simulated().map((s) => s.functionName), ["withdraw", "setDelegate", "execute", "multicall"]);
  assert.deepEqual(simulated()[2]!.args, [call.to, call.data]);
  assert.deepEqual(simulated()[3]!.args, [[call.to, call.to], [call.data, call.data]]);
  await assert.rejects(subaccounts.multicall(SUB, []), /at least one call/);
});
