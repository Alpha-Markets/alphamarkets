import type { OpenOrder } from "@orionis/sdk";

/// A limit order can be filled when it is open, has not expired, and the mark price has reached
/// its trigger: at or below it for a long, at or above it for a short. This mirrors
/// `PerpsEngine.executeLimitOrder`; the contract makes the final call, so a wrong answer here costs
/// at most a reverted simulation, never a bad fill.
export function isFillable(order: OpenOrder, markPrice: bigint, nowSeconds: bigint): boolean {
  if (order.status !== "OPEN") return false;
  if (nowSeconds > order.expiry) return false;
  return order.isLong ? markPrice <= order.triggerPrice : markPrice >= order.triggerPrice;
}

/// The lowest order id still worth looking at: every order below it is settled (filled or
/// cancelled) or expired. Orders are stored by ascending id, so the scan can start here next time.
/// `orders` must be ascending and start at `from`.
export function nextCursor(orders: OpenOrder[], from: bigint, nowSeconds: bigint): bigint {
  let cursor = from;
  for (const order of orders) {
    const finished = order.status !== "OPEN" || nowSeconds > order.expiry;
    if (!finished) break;
    cursor = order.id + 1n;
  }
  return cursor;
}

/// A price feed needs a fresh push once its last update is at least `refreshSeconds` old. Set it
/// well inside the oracle's staleness window (1 hour by default) so a late keeper tick does not
/// leave the market stale.
export function feedNeedsRefresh(updatedAt: bigint, nowSeconds: bigint, refreshSeconds: bigint): boolean {
  return nowSeconds - updatedAt >= refreshSeconds;
}
