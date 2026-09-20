import type { OpenOrder } from "@orionis/sdk";

export type OrderState = "open" | "filled" | "cancelled" | "expired";

/// An order still marked open on chain but past its expiry can no longer fill, so it reads as
/// expired: that is what the person should see, even though the chain keeps it as OPEN.
export function orderState(order: OpenOrder, nowSeconds: bigint): OrderState {
  if (order.status === "EXECUTED") return "filled";
  if (order.status === "CANCELLED") return "cancelled";
  return nowSeconds > order.expiry ? "expired" : "open";
}

const FINISHED_SHOWN = 5;

/// Open orders first (newest first), then the most recent finished ones, capped so a long history
/// does not bury the orders that are still waiting.
export function sortOrders(orders: OpenOrder[], nowSeconds: bigint): OpenOrder[] {
  const newestFirst = [...orders].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const open = newestFirst.filter((order) => orderState(order, nowSeconds) === "open");
  const finished = newestFirst.filter((order) => orderState(order, nowSeconds) !== "open").slice(0, FINISHED_SHOWN);
  return [...open, ...finished];
}

export const openOrderCount = (orders: OpenOrder[], nowSeconds: bigint) =>
  orders.filter((order) => orderState(order, nowSeconds) === "open").length;
