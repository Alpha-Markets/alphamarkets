import type { HistoryEvent } from "@alphamarkets/sdk";

/// What closed a position without the owner signing anything. `TRIGGER` is a trigger order whose
/// kind could not be resolved from the history that was read.
export type FillKind = "TAKE_PROFIT" | "STOP_LOSS" | "LIQUIDATION" | "TRIGGER";

export interface Fill {
  /// The history event id of the execution or liquidation, so a fill can be told apart and ordered.
  id: number;
  kind: FillKind;
  positionId: string;
  txHash: string;
  /// Price the position closed at, 18 decimals. Undefined only if the event did not carry one.
  price?: bigint;
  /// Realized PnL in settlement-token units, when the close event was in the history read.
  pnl?: bigint;
  isLong?: boolean;
  size?: bigint;
}

const big = (value: unknown): bigint | undefined => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
};

/// `TriggerKind` is the enum { STOP_LOSS, TAKE_PROFIT }, so the indexed value is 0 or 1.
function triggerKind(value: unknown): "STOP_LOSS" | "TAKE_PROFIT" | undefined {
  const n = big(value);
  return n === 0n ? "STOP_LOSS" : n === 1n ? "TAKE_PROFIT" : undefined;
}

/// Looks up facts about earlier events (which order was a stop-loss, what a position's side was,
/// what it realized on close) so a fill that arrives later can be described. Feed it every event
/// read so far, oldest first.
export class FillIndex {
  private orderKinds = new Map<string, "STOP_LOSS" | "TAKE_PROFIT">();
  private sides = new Map<string, { isLong?: boolean; size?: bigint }>();
  private closes = new Map<string, bigint>();

  /// Records what `events` say about orders, positions and closes. Safe to call with events seen before.
  learn(events: HistoryEvent[]): void {
    for (const event of events) {
      const args = event.args as Record<string, unknown>;
      const positionId = args.positionId === undefined ? undefined : String(args.positionId);
      if (event.eventName === "TriggerOrderPlaced") {
        const kind = triggerKind(args.kind);
        if (kind && args.orderId !== undefined) this.orderKinds.set(String(args.orderId), kind);
      } else if (event.eventName === "PerpPositionOpened" && positionId) {
        this.sides.set(positionId, { isLong: typeof args.isLong === "boolean" ? args.isLong : undefined, size: big(args.size) });
      } else if (event.eventName === "PerpPositionClosed" && positionId) {
        const pnl = big(args.realizedPnl);
        if (pnl !== undefined) this.closes.set(`${event.txHash}:${positionId}`, pnl);
      }
    }
  }

  /// The fills among `events`, oldest first: trigger orders that executed, and liquidations.
  /// Call `learn` first with the same events.
  fillsIn(events: HistoryEvent[]): Fill[] {
    const fills: Fill[] = [];
    for (const event of events) {
      const args = event.args as Record<string, unknown>;
      if (args.positionId === undefined) continue;
      const positionId = String(args.positionId);
      const side = this.sides.get(positionId);

      if (event.eventName === "TriggerOrderExecuted") {
        const pnl = this.closes.get(`${event.txHash}:${positionId}`);
        // The kind lives on the order's placement event. Without it, a profit or a loss says which it was.
        const kind: FillKind =
          this.orderKinds.get(String(args.orderId)) ?? (pnl === undefined ? "TRIGGER" : pnl > 0n ? "TAKE_PROFIT" : "STOP_LOSS");
        fills.push({ id: event.id, kind, positionId, txHash: event.txHash, price: big(args.executionPrice), pnl, ...side });
      } else if (event.eventName === "PositionLiquidated") {
        fills.push({
          id: event.id,
          kind: "LIQUIDATION",
          positionId,
          txHash: event.txHash,
          price: big(args.markPriceAtLiquidation),
          pnl: big(args.pnl),
          ...side,
        });
      }
    }
    return fills;
  }
}

export interface FillSummary {
  count: number;
  /// Sum of the fills whose PnL is known. Undefined when none of them had one.
  pnl?: bigint;
}

export function summarize(fills: Fill[]): FillSummary {
  const known = fills.filter((fill) => fill.pnl !== undefined);
  return {
    count: fills.length,
    pnl: known.length === 0 ? undefined : known.reduce((sum, fill) => sum + (fill.pnl as bigint), 0n),
  };
}

export const fillTitle: Record<FillKind, string> = {
  TAKE_PROFIT: "Take profit hit",
  STOP_LOSS: "Stop loss triggered",
  LIQUIDATION: "Position liquidated",
  TRIGGER: "Trigger order filled",
};

/// The label History shows for a closed position, so it matches the alert.
export const closeLabel: Record<FillKind, string> = {
  TAKE_PROFIT: "Take profit",
  STOP_LOSS: "Stop loss",
  LIQUIDATION: "Liquidated",
  TRIGGER: "Trigger order",
};

/// Reads the localStorage cursor value; a missing or damaged value is "no cursor".
export function parseCursor(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
