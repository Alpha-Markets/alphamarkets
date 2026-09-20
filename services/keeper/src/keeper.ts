import { OrionisContractError, type Orionis } from "@orionis/sdk";
import { parseAbi, type Account, type PublicClient, type WalletClient } from "viem";
import { feedNeedsRefresh, isFillable, isTriggerReached, nextCursor } from "./logic.js";

const feedAbi = parseAbi([
  "function owner() view returns (address)",
  "function latestPrice() view returns (uint256 price, uint256 timestamp)",
  "function setPrice(uint256 price)",
]);
const routerAbi = parseAbi(["function primarySource(bytes32 marketId) view returns (address)"]);

export interface KeeperDeps {
  orionis: Orionis;
  publicClient: PublicClient;
  /// Signs the keeper's own transactions. Must be built with a local account: that account is the
  /// keeper's address, and it must own a mock feed to refresh it.
  walletClient: WalletClient;
  refreshSeconds: bigint;
  /// Refresh mock feeds. Off when a real feed adapter is in use.
  refreshFeeds: boolean;
  log?: (message: string) => void;
}

export interface Keeper {
  /// One pass: refresh stale feeds, fill any limit order whose trigger is reached, then fire any
  /// stop-loss or take-profit whose trigger is reached.
  tick(): Promise<{ refreshed: number; filled: number; triggered: number }>;
}

/// One line a person can act on: viem's short message when there is one, else the first line.
function describe(error: unknown): string {
  if (error instanceof OrionisContractError) return error.errorName;
  const { shortMessage, message } = error as { shortMessage?: string; message?: string };
  return shortMessage ?? message?.split("\n")[0] ?? String(error);
}

export function createKeeper(deps: KeeperDeps): Keeper {
  const { orionis, publicClient, walletClient, refreshSeconds } = deps;
  if (!walletClient.account) throw new Error("keeper: the wallet client needs an account to sign with");
  // Kept in a const so the check above still holds inside the functions below.
  const account: Account = walletClient.account;
  const log = deps.log ?? ((message) => console.log(`keeper: ${message}`));
  let orderCursor = 1n;
  let triggerCursor = 1n;

  async function chainNow(): Promise<bigint> {
    return (await publicClient.getBlock()).timestamp;
  }

  /// Re-pushes each mock feed's current price when it is about to go stale. This only keeps the
  /// testnet market alive: it does not move the price. A feed this keeper does not own is left alone.
  async function refreshFeeds(now: bigint): Promise<number> {
    let refreshed = 0;
    for (const market of await orionis.markets.list()) {
      if (!market.active) continue;
      try {
        const feed = await publicClient.readContract({
          address: orionis.addresses.oracleRouter,
          abi: routerAbi,
          functionName: "primarySource",
          args: [market.oracleId],
        });
        if (feed === "0x0000000000000000000000000000000000000000") continue;

        const owner = await publicClient.readContract({ address: feed, abi: feedAbi, functionName: "owner" }).catch(() => undefined);
        if (owner?.toLowerCase() !== account.address.toLowerCase()) continue;

        const [price, updatedAt] = await publicClient.readContract({ address: feed, abi: feedAbi, functionName: "latestPrice" });
        if (!feedNeedsRefresh(updatedAt, now, refreshSeconds)) continue;

        const { request } = await publicClient.simulateContract({ address: feed, abi: feedAbi, functionName: "setPrice", args: [price], account });
        const hash = await walletClient.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        refreshed++;
        log(`refreshed the ${market.marketId} feed (${hash})`);
      } catch (error) {
        log(`could not refresh the ${market.marketId} feed: ${describe(error)}`);
      }
    }
    return refreshed;
  }

  /// Fills every open order whose trigger is reached. Anyone can call `executeLimitOrder`, so this
  /// needs no privileges, only gas. An order that reverts (its owner withdrew the margin, a limit
  /// was hit) is left open and tried again next tick, until it expires or is cancelled.
  async function fillOrders(now: bigint): Promise<number> {
    if (!orionis.addresses.perpOrderManager) return 0;

    const orders = await orionis.perps.scanOrders(orderCursor);
    orderCursor = nextCursor(orders, orderCursor, now);

    const marks = new Map<string, bigint>();
    let filled = 0;
    for (const order of orders) {
      if (order.status !== "OPEN") continue;
      try {
        if (!marks.has(order.marketId)) marks.set(order.marketId, (await orionis.oracle.getMarkPrice(order.marketId)).price);
        if (!isFillable(order, marks.get(order.marketId)!, now)) continue;

        const { hash, positionId } = await orionis.perps.executeLimitOrder(order.id, { wait: true });
        filled++;
        log(`filled order ${order.id} as position ${positionId} (${hash})`);
      } catch (error) {
        log(`order ${order.id} not filled: ${describe(error)}`);
      }
    }
    return filled;
  }

  /// Fires every stop-loss and take-profit whose trigger is reached. Like `executeLimitOrder`,
  /// `executeTriggerOrder` is permissionless, so this needs only gas. An order whose position was
  /// closed or liquidated some other way can never fire; it is skipped and the cursor moves past
  /// it. Any other failure leaves the order open to be tried again next tick.
  async function fireTriggers(now: bigint): Promise<number> {
    // A deployment made before `[1.3.0]` has an order manager without trigger orders: nothing to scan.
    if (!(await orionis.perps.supportsTriggerOrders())) return 0;

    const orders = await orionis.perps.scanTriggerOrders(triggerCursor);
    const dead = new Set<bigint>();
    const marks = new Map<string, bigint>();
    let triggered = 0;
    for (const order of orders) {
      if (order.status !== "OPEN" || now > order.expiry) continue;
      try {
        const position = await orionis.portfolio.getPerpPosition(order.positionId);
        if (!position.open) {
          dead.add(order.id);
          continue;
        }
        if (!marks.has(position.marketId)) marks.set(position.marketId, (await orionis.oracle.getMarkPrice(position.marketId)).price);
        if (!isTriggerReached(order, position.isLong, marks.get(position.marketId)!, now)) continue;

        const hash = await orionis.perps.executeTriggerOrder(order.id, { wait: true });
        triggered++;
        log(`fired ${order.kind} order ${order.id} on position ${order.positionId} (${hash})`);
      } catch (error) {
        log(`trigger order ${order.id} not fired: ${describe(error)}`);
      }
    }
    triggerCursor = nextCursor(
      orders.map((order) => (dead.has(order.id) ? { ...order, status: "CANCELLED" as const } : order)),
      triggerCursor,
      now,
    );
    return triggered;
  }

  return {
    async tick() {
      const now = await chainNow();
      const refreshed = deps.refreshFeeds ? await refreshFeeds(now) : 0;
      const filled = await fillOrders(now);
      // A failure here must not hide the limit orders and feed refresh above from the caller.
      const triggered = await fireTriggers(now).catch((error) => {
        log(`could not scan trigger orders: ${describe(error)}`);
        return 0;
      });
      return { refreshed, filled, triggered };
    },
  };
}
