import type { ContractAddresses } from "@orionis/config";
import type { Address, Hex } from "@orionis/types";
import { perpOrderManagerAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { NotImplementedError } from "./errors.js";

export type OrderStatus = "OPEN" | "EXECUTED" | "CANCELLED";

/// A resting limit order to open a perp position (PROJECT_BRIEF.md Section 39). Nothing is
/// reserved in the Vault while it rests; the margin and taker fee are taken when it fills.
export interface OpenOrder {
  id: bigint;
  marketId: Hex;
  isLong: boolean;
  /// Margin to post on fill, settlement-token base units.
  collateral: bigint;
  leverage: bigint;
  /// Worst acceptable entry price, 18 decimals: a long fills at or below it, a short at or above.
  triggerPrice: bigint;
  /// Unix seconds. The order can no longer fill after this.
  expiry: bigint;
  owner: Address;
  status: OrderStatus;
  /// The position the order opened; 0 until it fills.
  positionId: bigint;
}

const STATUS: OrderStatus[] = ["OPEN", "EXECUTED", "CANCELLED"];

/// The order manager's address, or a clear error on a deployment that predates limit orders.
export function requireOrderManager(addresses: ContractAddresses, method: string): Address {
  if (!addresses.perpOrderManager) {
    throw new NotImplementedError(
      method,
      "this deployment has no PerpOrderManager (limit orders need a deployment made after [1.2.0])",
    );
  }
  return addresses.perpOrderManager;
}

function toOrder(id: bigint, raw: {
  marketId: Hex;
  isLong: boolean;
  collateral: bigint;
  leverage: bigint;
  triggerPrice: bigint;
  expiry: bigint;
  owner: Address;
  status: number;
  positionId: bigint;
}): OpenOrder {
  return {
    id,
    marketId: raw.marketId,
    isLong: raw.isLong,
    collateral: raw.collateral,
    leverage: raw.leverage,
    triggerPrice: raw.triggerPrice,
    expiry: raw.expiry,
    owner: raw.owner,
    status: STATUS[raw.status] ?? "OPEN",
    positionId: raw.positionId,
  };
}

export async function readOrder(client: OrionisClient, addresses: ContractAddresses, orderId: bigint): Promise<OpenOrder> {
  const raw = await client.readContract({
    address: requireOrderManager(addresses, "perps.getOrder"),
    abi: perpOrderManagerAbi,
    functionName: "getOrder",
    args: [orderId],
  });
  return toOrder(orderId, raw);
}

/// Every order a user ever placed, oldest first, read from the chain. Filter on `status` for the
/// resting ones. A deployment without an order manager has none, so this returns an empty list
/// rather than throwing (a portfolio view should still render).
export async function readUserOrders(client: OrionisClient, addresses: ContractAddresses, user: Address): Promise<OpenOrder[]> {
  const manager = addresses.perpOrderManager;
  if (!manager) return [];
  const ids = await client.readContract({ address: manager, abi: perpOrderManagerAbi, functionName: "getUserOrders", args: [user] });
  return Promise.all(ids.map((id) => readOrder(client, addresses, id)));
}

/// Ids of every order ever placed, `from` (inclusive) up to the newest, for a keeper scanning the
/// whole book.
export async function readOrderRange(
  client: OrionisClient,
  addresses: ContractAddresses,
  from: bigint,
): Promise<OpenOrder[]> {
  const manager = requireOrderManager(addresses, "perps.scanOrders");
  const last = await client.readContract({ address: manager, abi: perpOrderManagerAbi, functionName: "nextOrderId" });
  const ids: bigint[] = [];
  for (let id = from < 1n ? 1n : from; id <= last; id++) ids.push(id);
  return Promise.all(ids.map((id) => readOrder(client, addresses, id)));
}
