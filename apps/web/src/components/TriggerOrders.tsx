"use client";

import { Button, Segmented, TextField } from "@alphamarkets/ui";
import type { TriggerKind, TriggerOrder } from "@alphamarkets/sdk";
import type { PerpPosition } from "@alphamarkets/types";
import { useState } from "react";
import { usePositions, useTriggerOrders } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { useWalletAlphaMarkets } from "@/hooks/useAlphaMarkets";
import { useTx } from "@/hooks/useTx";
import { fmtPrice } from "@/lib/format";
import { parseLimitPrice } from "@/lib/limit";
import { perpLabel } from "@/lib/market";
import { openTriggersFor, sortTriggers, TRIGGER_LABEL, triggerProblem, triggerSide, triggerState } from "@/lib/triggers";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

const KIND_OPTIONS: Array<{ value: TriggerKind; label: string }> = [
  { value: "STOP_LOSS", label: "Stop-loss" },
  { value: "TAKE_PROFIT", label: "Take-profit" },
];

/// "≤ 180.00" for an order that fires as the price falls to it, "≥ 200.00" as it rises to it.
const firesAt = (isLong: boolean, order: TriggerOrder) => `${triggerSide(isLong, order.kind) === "below" ? "≤" : "≥"} ${fmtPrice(order.triggerPrice)}`;

/// Stop-loss and take-profit orders for one open position, and a form to add one. When the mark
/// reaches the trigger anyone (the keeper) can fire the order and the whole position closes at the
/// mark price, which can be worse than the trigger if the price jumps past it.
export function PositionTriggers({ position, mark }: { position: PerpPosition; mark: bigint | undefined }) {
  const wallet = useWalletAlphaMarkets();
  const run = useTx();
  const now = useNow();
  const { data: orders = [] } = useTriggerOrders();
  const [kind, setKind] = useState<TriggerKind>("STOP_LOSS");
  const [price, setPrice] = useState("");

  const waiting = openTriggersFor(orders, position.positionId, BigInt(Math.floor(now / 1000)));
  const problem = triggerProblem(position.isLong, kind, price, mark);
  const parsed = parseLimitPrice(price);
  const side = triggerSide(position.isLong, kind);
  const label = perpLabel(position.marketId);

  return (
    <div className="flex flex-col gap-3 p-3">
      {waiting.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {waiting.map((order) => (
            <li key={order.id.toString()} className="flex items-center gap-3">
              <span className="w-28">{TRIGGER_LABEL[order.kind]}</span>
              <span className="tabular-nums">{firesAt(position.isLong, order)}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={!wallet}
                onClick={() =>
                  run({ title: `Cancel ${TRIGGER_LABEL[order.kind].toLowerCase()}`, summary: `${label} · ${firesAt(position.isLong, order)}` }, (tx) =>
                    wallet!.perps.cancelTriggerOrder(order.id, tx),
                  )
                }
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No stop-loss or take-profit on this position.</p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Segmented label="Trigger type" className="w-56" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        <TextField
          label="Trigger price"
          className="w-44"
          value={price}
          placeholder={mark === undefined ? "0.00" : fmtPrice(mark).replace(/,/g, "")}
          suffix="USD"
          invalid={problem !== undefined}
          hint={problem ?? `Closes the position once the mark is ${side === "below" ? "at or below" : "at or above"} this price.`}
          onValueChange={setPrice}
        />
        <Button
          disabled={!wallet || parsed === undefined || problem !== undefined}
          onClick={() =>
            run({ title: `Place ${TRIGGER_LABEL[kind].toLowerCase()}`, summary: `${label} · ${position.isLong ? "Long" : "Short"} · at ${price}` }, (tx) =>
              wallet!.perps.placeTriggerOrder({ positionId: position.positionId, kind, triggerPrice: parsed!, tx }),
            ).then((result) => {
              if (result.ok) setPrice("");
            })
          }
        >
          Place
        </Button>
      </div>
      <p className="text-xs leading-snug text-muted">
        A stop-loss or take-profit closes the whole position at the mark price when it fires. If the price jumps past the trigger, the position closes at the new price, not at the trigger.
      </p>
    </div>
  );
}

/// The wallet's stop-loss and take-profit orders. Waiting ones first, then the most recent
/// finished ones so a fire or a cancel does not just vanish.
export function TriggerOrdersTable() {
  const wallet = useWalletAlphaMarkets();
  const run = useTx();
  const now = useNow();
  const { data: orders } = useTriggerOrders();
  const { data: positions } = usePositions();

  if (!orders || orders.length === 0) return null;

  const nowSeconds = BigInt(Math.floor(now / 1000));
  const byId = new Map(positions?.perps.map((position) => [position.positionId, position]));
  const isOpen = (positionId: bigint) => (byId.has(positionId) ? byId.get(positionId)!.open : undefined);

  return (
    <div className="border-t border-line">
      <p className="px-3 pt-3 text-xs text-muted">Stop-loss and take-profit</p>
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th className={head}>Market</th>
            <th className={head}>Type</th>
            <th className={head}>Fires at</th>
            <th className={head}>Status</th>
            <th className={head} />
          </tr>
        </thead>
        <tbody>
          {sortTriggers(orders, nowSeconds, isOpen).map((order) => {
            const position = byId.get(order.positionId);
            const state = triggerState(order, nowSeconds, isOpen(order.positionId));
            return (
              <tr key={order.id.toString()} className="border-t border-line">
                <td className={cell}>
                  <span className="font-medium">{position ? perpLabel(position.marketId) : `Position ${order.positionId}`}</span>
                  {position ? <span className={position.isLong ? "ml-2 text-up" : "ml-2 text-down"}>{position.isLong ? "Long" : "Short"}</span> : null}
                </td>
                <td className={cell}>{TRIGGER_LABEL[order.kind]}</td>
                <td className={cell}>{position ? firesAt(position.isLong, order) : fmtPrice(order.triggerPrice)}</td>
                <td className={cell}>
                  <span className={state === "open" ? "text-text" : "text-muted"}>{state === "open" ? "Waiting" : state[0]!.toUpperCase() + state.slice(1)}</span>
                </td>
                <td className={cell}>
                  {state === "open" || state === "position closed" ? (
                    <Button
                      size="sm"
                      disabled={!wallet}
                      onClick={() => run({ title: `Cancel ${TRIGGER_LABEL[order.kind].toLowerCase()}`, summary: `Position ${order.positionId}` }, (tx) => wallet!.perps.cancelTriggerOrder(order.id, tx))}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
