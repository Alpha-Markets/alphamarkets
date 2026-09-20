import { OrionisContractError, type Orionis } from "@orionis/sdk";
import { parseAbi, type Account, type PublicClient, type WalletClient } from "viem";
import { feedNeedsRefresh, isFillable, nextCursor } from "./logic.js";

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
  /// One pass: refresh stale feeds, then fill any limit order whose trigger is reached.
  tick(): Promise<{ refreshed: number; filled: number }>;
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

  return {
    async tick() {
      const now = await chainNow();
      const refreshed = deps.refreshFeeds ? await refreshFeeds(now) : 0;
      const filled = await fillOrders(now);
      return { refreshed, filled };
    },
  };
}
