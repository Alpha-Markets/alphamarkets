"use client";

import { Button } from "@alphamarkets/ui";
import type { OpenOrder } from "@alphamarkets/sdk";
import { useOrders, useSettlementDecimals } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { useWalletAlphaMarkets } from "@/hooks/useAlphaMarkets";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtPrice, fmtUsd } from "@/lib/format";
import { perpLabel } from "@/lib/market";
import { orderState, sortOrders } from "@/lib/orders";
import { TriggerOrdersTable } from "./TriggerOrders";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

const STATE_TEXT = { open: "Waiting", filled: "Filled", cancelled: "Cancelled", expired: "Expired" } as const;

function fmtExpiry(expiry: bigint, nowMs: number): string {
  const remaining = Number(expiry) - Math.floor(nowMs / 1000);
  if (remaining <= 0) return new Date(Number(expiry) * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  if (remaining < 3_600) return `in ${Math.ceil(remaining / 60)}m`;
  if (remaining < 86_400) return `in ${Math.floor(remaining / 3_600)}h ${Math.floor((remaining % 3_600) / 60)}m`;
  return `in ${Math.floor(remaining / 86_400)}d ${Math.floor((remaining % 86_400) / 3_600)}h`;
}

function OrderRow({ order, decimals, nowMs }: { order: OpenOrder; decimals: number; nowMs: number }) {
  const wallet = useWalletAlphaMarkets();
  const run = useTx();
  const state = orderState(order, BigInt(Math.floor(nowMs / 1000)));

  return (
    <tr className="border-t border-line">
      <td className={cell}>
        <span className="font-medium">{perpLabel(order.marketId)}</span>
        <span className={order.isLong ? "ml-2 text-up" : "ml-2 text-down"}>{order.isLong ? "Long" : "Short"}</span>
      </td>
      <td className={cell}>{fmtUsd(order.collateral * order.leverage, decimals)}</td>
      <td className={cell}>{`${order.leverage}x`}</td>
      <td className={cell}>{fmtUsd(order.collateral, decimals)}</td>
      <td className={cell}>
        {order.isLong ? "≤ " : "≥ "}
        {fmtPrice(order.triggerPrice)}
      </td>
      <td className={cell}>{state === "open" ? fmtExpiry(order.expiry, nowMs) : "–"}</td>
      <td className={cell}>
        <span className={state === "open" ? "text-text" : "text-muted"}>{STATE_TEXT[state]}</span>
      </td>
      <td className={cell}>
        {state === "open" ? (
          <Button
            size="sm"
            disabled={!wallet}
            onClick={() =>
              run({ title: "Cancel limit order", summary: `${perpLabel(order.marketId)} · ${order.isLong ? "Long" : "Short"} · at ${fmtPrice(order.triggerPrice)}` }, (tx) =>
                wallet!.perps.cancelLimitOrder(order.id, tx),
              )
            }
          >
            Cancel
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

/// Limit orders for the connected wallet, read from the chain. Open ones first, then the most
/// recent finished ones so a fill or a cancel does not just vanish.
export function OrdersTable() {
  const { data, isPending, isError } = useOrders();
  const { data: decimals = 6 } = useSettlementDecimals();
  const now = useNow();

  if (!env.limitOrders) {
    return <p className="p-3 text-muted">Limit orders need the latest contracts, which are not deployed on this network yet. Market orders fill immediately.</p>;
  }
  if (isError) return <p className="p-3 text-down">Could not read your orders from the chain. Check NEXT_PUBLIC_RPC_URL.</p>;
  if (isPending) return <p className="p-3 text-muted">Loading orders…</p>;
  if (data.length === 0) {
    return (
      <>
        <p className="p-3 text-muted">No limit orders. Place one from the Perpetuals terminal by choosing Limit.</p>
        <TriggerOrdersTable />
      </>
    );
  }

  const orders = sortOrders(data, BigInt(Math.floor(now / 1000)));
  return (
    <>
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr>
            <th className={head}>Market</th>
            <th className={head}>Size</th>
            <th className={head}>Leverage</th>
            <th className={head}>Margin</th>
            <th className={head}>Fills at</th>
            <th className={head}>Expires</th>
            <th className={head}>Status</th>
            <th className={head} />
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRow key={order.id.toString()} order={order} decimals={decimals} nowMs={now} />
          ))}
        </tbody>
      </table>
      <TriggerOrdersTable />
    </>
  );
}
