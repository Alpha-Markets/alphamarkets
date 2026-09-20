import { triggerFiresBelow, type TriggerKind, type TriggerOrder } from "@alphamarkets/sdk";
import { parseUnits } from "viem";
import { PRICE_DECIMALS, fmtPrice } from "./format";
import { parseLimitPrice } from "./limit";

export const TRIGGER_LABEL: Record<TriggerKind, string> = { STOP_LOSS: "Stop-loss", TAKE_PROFIT: "Take-profit" };

/// Which side of the mark the trigger must sit on when it is placed, so it does not fire at once.
/// A long's stop-loss and a short's take-profit sit below it; the other two sit above.
export const triggerSide = (isLong: boolean, kind: TriggerKind): "below" | "above" => (triggerFiresBelow(isLong, kind) ? "below" : "above");

/// Why a trigger price cannot be placed, in words for the form; `undefined` when it can, or when
/// nothing has been typed yet. The contract makes the final call (`InvalidTriggerPrice`).
export function triggerProblem(isLong: boolean, kind: TriggerKind, text: string, mark: bigint | undefined): string | undefined {
  if (text.trim() === "") return undefined;
  const price = parseLimitPrice(text);
  if (price === undefined) return "Enter a price above zero.";
  if (mark === undefined) return undefined;

  const value = parseUnits(price, PRICE_DECIMALS);
  const side = triggerSide(isLong, kind);
  const wrongSide = side === "below" ? value >= mark : value <= mark;
  return wrongSide ? `A ${isLong ? "long" : "short"}'s ${TRIGGER_LABEL[kind].toLowerCase()} must be ${side} the mark (${fmtPrice(mark)}).` : undefined;
}

export type TriggerState = "open" | "fired" | "cancelled" | "expired" | "position closed";

/// An order still open on chain but past its expiry, or on a position that has closed, can no
/// longer fire, so it reads that way: the chain keeps it as OPEN, but that is not what the person
/// should see.
export function triggerState(order: TriggerOrder, nowSeconds: bigint, positionOpen: boolean | undefined): TriggerState {
  if (order.status === "EXECUTED") return "fired";
  if (order.status === "CANCELLED") return "cancelled";
  if (nowSeconds > order.expiry) return "expired";
  return positionOpen === false ? "position closed" : "open";
}

/// The orders still waiting to fire on one position, newest first.
export function openTriggersFor(orders: TriggerOrder[], positionId: bigint, nowSeconds: bigint): TriggerOrder[] {
  return orders
    .filter((order) => order.positionId === positionId && triggerState(order, nowSeconds, true) === "open")
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const FINISHED_SHOWN = 5;

/// Waiting orders first (newest first), then the most recent finished ones, capped so a long
/// history does not bury what is still waiting.
export function sortTriggers(
  orders: TriggerOrder[],
  nowSeconds: bigint,
  isPositionOpen: (positionId: bigint) => boolean | undefined,
): TriggerOrder[] {
  const newestFirst = [...orders].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const waiting = newestFirst.filter((order) => triggerState(order, nowSeconds, isPositionOpen(order.positionId)) === "open");
  const finished = newestFirst.filter((order) => triggerState(order, nowSeconds, isPositionOpen(order.positionId)) !== "open").slice(0, FINISHED_SHOWN);
  return [...waiting, ...finished];
}
