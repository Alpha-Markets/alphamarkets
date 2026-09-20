import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenOrder } from "@alphamarkets/sdk";
import { openOrderCount, orderState, sortOrders } from "./orders.js";

const order = (id: bigint, overrides: Partial<OpenOrder> = {}): OpenOrder => ({
  id,
  marketId: `0x${"11".repeat(32)}`,
  isLong: true,
  collateral: 1n,
  leverage: 2n,
  triggerPrice: 1n,
  expiry: 1_000n,
  owner: `0x${"01".repeat(20)}`,
  status: "OPEN",
  positionId: 0n,
  ...overrides,
});

test("an order past its expiry reads as expired even though the chain keeps it open", () => {
  assert.equal(orderState(order(1n), 999n), "open");
  assert.equal(orderState(order(1n), 1_000n), "open", "the last second still counts");
  assert.equal(orderState(order(1n), 1_001n), "expired");
  assert.equal(orderState(order(1n, { status: "EXECUTED" }), 5n), "filled");
  assert.equal(orderState(order(1n, { status: "CANCELLED" }), 5n), "cancelled");
});

test("open orders come first, and only the newest finished ones follow", () => {
  const orders = [
    order(1n, { status: "EXECUTED" }),
    order(2n),
    order(3n, { status: "CANCELLED" }),
    order(4n, { expiry: 10n }),
    order(5n),
    ...[6n, 7n, 8n, 9n, 10n].map((id) => order(id, { status: "CANCELLED" })),
  ];
  const sorted = sortOrders(orders, 500n);
  assert.deepEqual(sorted.slice(0, 2).map((o) => o.id), [5n, 2n]);
  assert.equal(sorted.length, 2 + 5);
  assert.deepEqual(sorted.slice(2).map((o) => o.id), [10n, 9n, 8n, 7n, 6n]);
  assert.equal(openOrderCount(orders, 500n), 2);
});
