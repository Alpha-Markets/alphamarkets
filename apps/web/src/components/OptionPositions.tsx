"use client";

import { Panel } from "@orionis/ui";
import { OptionPositionStatus } from "@orionis/sdk";
import { useAccount } from "wagmi";
import { usePositions } from "@/hooks/queries";
import { OptionPositionsTable } from "./OptionPositionsTable";

/// Open option positions under the chain, so a buyer sees the trade land without leaving the page.
/// Closed and settled ones stay on the Portfolio page.
export function OptionPositions() {
  const { isConnected } = useAccount();
  const { data, isPending } = usePositions();
  const open = data?.options.filter((position) => position.status === OptionPositionStatus.OPEN) ?? [];

  return (
    <Panel title={`Option positions${open.length ? ` (${open.length})` : ""}`} className="h-64 shrink-0">
      <div className="min-h-0 flex-1 overflow-auto">
        {!isConnected ? (
          <p className="p-3 text-muted">Connect a wallet to see your option positions.</p>
        ) : isPending ? (
          <p className="p-3 text-muted">Loading positions…</p>
        ) : open.length === 0 ? (
          <p className="p-3 text-muted">No open options. Pick a call or put from the chain to buy one.</p>
        ) : (
          <OptionPositionsTable positions={open} />
        )}
      </div>
    </Panel>
  );
}
