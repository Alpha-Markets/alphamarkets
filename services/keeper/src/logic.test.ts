import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenOrder } from "@orionis/sdk";
import { feedNeedsRefresh, isFillable, nextCursor } from "./logic.js";

const WAD = 10n ** 18n;
const order = (overrides: Partial<OpenOrder> = {}): OpenOrder => ({
  id: 1n,
  marketId: `0x${"11".repeat(32)}`,
  isLong: true,
  collateral: 1_000n,
  leverage: 5n,
  triggerPrice: 180n * WAD,
  expiry: 2_000n,
  owner: `0x${"01".repeat(20)}`,
  status: "OPEN",
  positionId: 0n,
  ...overrides,
});

test("a long fills at or below its trigger, a short at or above it", () => {
  assert.equal(isFillable(order(), 181n * WAD, 100n), false);
  assert.equal(isFillable(order(), 180n * WAD, 100n), true);
  assert.equal(isFillable(order(), 170n * WAD, 100n), true);

  const short = order({ isLong: false, triggerPrice: 200n * WAD });
  assert.equal(isFillable(short, 199n * WAD, 100n), false);
  assert.equal(isFillable(short, 200n * WAD, 100n), true);
  assert.equal(isFillable(short, 210n * WAD, 100n), true);
});

test("a filled, cancelled or expired order never fills", () => {
  assert.equal(isFillable(order({ status: "EXECUTED" }), 1n, 100n), false);
  assert.equal(isFillable(order({ status: "CANCELLED" }), 1n, 100n), false);
  assert.equal(isFillable(order({ expiry: 100n }), 1n, 101n), false);
  assert.equal(isFillable(order({ expiry: 100n }), 1n, 100n), true, "the last second still counts");
});

test("the cursor skips finished orders but stops at the first live one", () => {
  const orders = [
    order({ id: 4n, status: "EXECUTED" }),
    order({ id: 5n, status: "CANCELLED" }),
    order({ id: 6n, expiry: 50n }),
    order({ id: 7n }),
    order({ id: 8n, status: "EXECUTED" }), // finished, but behind a live order
  ];
  assert.equal(nextCursor(orders, 4n, 100n), 7n);
  assert.equal(nextCursor([], 4n, 100n), 4n);
  assert.equal(nextCursor([order({ id: 9n, status: "EXECUTED" })], 9n, 100n), 10n);
});

test("a feed is refreshed once it is old enough, not before", () => {
  assert.equal(feedNeedsRefresh(1_000n, 2_799n, 1_800n), false);
  assert.equal(feedNeedsRefresh(1_000n, 2_800n, 1_800n), true);
});
