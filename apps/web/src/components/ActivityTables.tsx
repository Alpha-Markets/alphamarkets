"use client";

import { Num, textLink } from "@alphamarkets/ui";
import type { FundingPayment, HistoryEvent } from "@alphamarkets/sdk";
import { useFunding, useHistory, useSettlementDecimals } from "@/hooks/queries";
import { env } from "@/lib/env";
import { closeLabel, FillIndex } from "@/lib/fills";
import { fmt, fmtPrice, fmtSigned, shortHash, signTone } from "@/lib/format";
import { perpLabel } from "@/lib/market";
import { fmtDateTime } from "@/lib/options";
import { alphaMarketsRead } from "@/lib/alphamarkets";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

function txLink(hash: string) {
  try {
    return alphaMarketsRead.explorer.txUrl(hash as `0x${string}`);
  } catch {
    return undefined; // NEXT_PUBLIC_EXPLORER_URL is not set
  }
}

function TxCell({ hash }: { hash: string }) {
  const link = txLink(hash);
  return (
    <td className={cell}>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className={textLink}>
          {shortHash(hash)}
        </a>
      ) : (
        shortHash(hash)
      )}
    </td>
  );
}

const needsApi = (what: string) => (
  <p className="p-3 text-muted">{what} come from the indexer. Set NEXT_PUBLIC_API_URL to show them.</p>
);

export function FundingTable() {
  const { data, isPending, isError } = useFunding();
  const { data: decimals = 6 } = useSettlementDecimals();
  if (!env.apiUrl) return needsApi("Funding payments");
  if (isError) return <p className="p-3 text-down">The funding history is not available right now.</p>;
  if (isPending) return <p className="p-3 text-muted">Loading funding…</p>;
  if (data.length === 0) return <p className="p-3 text-muted">No funding payments yet. They appear once a position is open across a funding interval.</p>;

  const total = data.reduce((sum: bigint, row: FundingPayment) => sum + row.amount, 0n);
  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr>
          <th className={head}>Time</th>
          <th className={head}>Market</th>
          <th className={head}>Position</th>
          <th className={head}>Received / paid</th>
          <th className={head}>Transaction</th>
        </tr>
      </thead>
      <tbody>
        {[...data].reverse().map((row) => (
          <tr key={row.id} className="border-t border-line">
            <td className={cell}>{fmtDateTime(row.createdAt)}</td>
            <td className={cell}>{perpLabel(row.marketId)}</td>
            <td className={cell}>#{row.positionId.toString()}</td>
            <td className={cell}>
              <Num tone={signTone(row.amount, decimals, 4)}>{fmtSigned(row.amount, decimals, 4)}</Num>
            </td>
            <TxCell hash={row.txHash} />
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-line">
          <td className={cell} colSpan={3}>
            Net funding
          </td>
          <td className={cell}>
            <Num tone={signTone(total, decimals, 4)}>{fmtSigned(total, decimals, 4)}</Num>
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

const eventLabels: Record<string, string> = {
  CollateralDeposited: "Deposit",
  CollateralWithdrawn: "Withdrawal",
  OptionPositionOpened: "Option opened",
  OptionPositionClosed: "Option closed",
  OptionExercised: "Option paid out",
  PerpPositionOpened: "Perp opened",
  PerpPositionUpdated: "Perp changed",
  PerpPositionClosed: "Perp closed",
  PositionLiquidated: "Liquidated",
  TriggerOrderPlaced: "Trigger order set",
  TriggerOrderCancelled: "Trigger order cancelled",
  TriggerOrderExecuted: "Trigger order filled",
  ProtocolFeeCollected: "Fee",
};

const TRIGGER_KINDS: Record<string, string> = { "0": "Stop loss", "1": "Take profit" };

function details(event: HistoryEvent, decimals: number): string {
  const args = event.args as Record<string, string | undefined>;
  const parts: string[] = [];
  if (args.positionId) parts.push(`Position #${args.positionId}`);
  if (args.size) parts.push(`Size $${fmt(BigInt(args.size), decimals, 2)}`);
  if (args.premium) parts.push(`Premium $${fmt(BigInt(args.premium), decimals, 2)}`);
  if (args.amount && /^-?\d+$/.test(args.amount)) parts.push(`$${fmt(BigInt(args.amount), decimals, 2)}`);
  if (args.realizedPnl) parts.push(`PnL ${fmtSigned(BigInt(args.realizedPnl), decimals)}`);
  if (args.pnl) parts.push(`PnL ${fmtSigned(BigInt(args.pnl), decimals)}`);
  if (args.triggerPrice) parts.push(`${TRIGGER_KINDS[args.kind ?? ""] ?? "Trigger"} at $${fmtPrice(BigInt(args.triggerPrice))}`);
  if (args.executionPrice) parts.push(`Filled at $${fmtPrice(BigInt(args.executionPrice))}`);
  return parts.join(", ") || "–";
}

export function HistoryTable() {
  const { data, isPending, isError } = useHistory();
  const { data: decimals = 6 } = useSettlementDecimals();
  if (!env.apiUrl) return needsApi("Transaction history");
  if (isError) return <p className="p-3 text-down">The transaction history is not available right now.</p>;
  if (isPending) return <p className="p-3 text-muted">Loading history…</p>;
  if (data.length === 0) return <p className="p-3 text-muted">No activity yet for this wallet.</p>;

  // A close that a trigger or a liquidation caused says so, matching the alert the user saw.
  const index = new FillIndex();
  index.learn(data);
  const closedBy = new Map(index.fillsIn(data).map((fill) => [`${fill.txHash}:${fill.positionId}`, fill.kind]));
  const label = (event: HistoryEvent) => {
    const kind = event.eventName === "PerpPositionClosed" ? closedBy.get(`${event.txHash}:${String((event.args as { positionId?: unknown }).positionId)}`) : undefined;
    return kind ? closeLabel[kind] : (eventLabels[event.eventName] ?? event.eventName);
  };

  return (
    <table className="w-full min-w-[640px] text-sm">
      <thead>
        <tr>
          <th className={head}>Time</th>
          <th className={head}>Event</th>
          <th className={head}>Details</th>
          <th className={head}>Block</th>
          <th className={head}>Transaction</th>
        </tr>
      </thead>
      <tbody>
        {[...data].reverse().map((event) => (
          <tr key={event.id} className="border-t border-line">
            <td className={cell}>{fmtDateTime(event.createdAt)}</td>
            <td className={cell}>{label(event)}</td>
            <td className={cell}>{details(event, decimals)}</td>
            <td className={cell}>{event.blockNumber}</td>
            <TxCell hash={event.txHash} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
