"use client";

import { Num, Panel, Stat, cn } from "@orionis/ui";
import { OptionPositionStatus } from "@orionis/sdk";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useOrders, usePortfolioSummary, useSettlementDecimals } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { openOrderCount } from "@/lib/orders";
import { fmtSigned, fmtUsd, signTone } from "@/lib/format";
import { FundingTable, HistoryTable } from "./ActivityTables";
import { OptionPositionsTable } from "./OptionPositionsTable";
import { OrdersTable } from "./OrdersTable";
import { PerpPositionsTable } from "./PositionsTable";

type Tab = "all" | "options" | "perps" | "orders" | "funding" | "history";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "all", label: "All positions" },
  { id: "options", label: "Options" },
  { id: "perps", label: "Perpetuals" },
  { id: "orders", label: "Open orders" },
  { id: "funding", label: "Funding" },
  { id: "history", label: "History" },
];

function Empty({ children }: { children: string }) {
  return <p className="p-3 text-muted">{children}</p>;
}

/// PROJECT_BRIEF.md Section 28.
export function PortfolioView() {
  const { isConnected } = useAccount();
  const { data: summary, isPending, error } = usePortfolioSummary();
  const { data: decimals = 6 } = useSettlementDecimals();
  const [tab, setTab] = useState<Tab>("all");
  const { data: orders } = useOrders();
  const now = useNow();
  const waiting = orders ? openOrderCount(orders, BigInt(Math.floor(now / 1000))) : 0;

  if (!isConnected) {
    return (
      <Panel title="Portfolio">
        <Empty>Connect a wallet to see your collateral, positions and history.</Empty>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title="Portfolio">
        <p className="p-3 text-down">Could not read your portfolio from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
      </Panel>
    );
  }

  const perps = summary?.positions.perps.filter((position) => position.open) ?? [];
  // Closed and settled options stay listed: they are part of the record and their realized PnL.
  const options = summary?.positions.options ?? [];
  const openOptions = options.filter((position) => position.status === OptionPositionStatus.OPEN);
  const value = summary ? summary.balances.balance + summary.unrealizedPerpPnl : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="border border-line bg-surface p-4">
        <p className="text-xs text-muted">Portfolio value</p>
        <p className="mt-1 text-3xl font-medium tabular-nums">{isPending ? "–" : fmtUsd(value, decimals)}</p>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          <Stat label="Available collateral">{fmtUsd(summary?.balances.available, decimals)}</Stat>
          <Stat label="Locked margin">{fmtUsd(summary?.balances.lockedMargin, decimals)}</Stat>
          <Stat label="Unrealized PnL">
            <Num tone={signTone(summary?.unrealizedPerpPnl, decimals)}>{fmtSigned(summary?.unrealizedPerpPnl, decimals)}</Num>
          </Stat>
          <Stat label="Realized PnL">
            <Num tone={signTone(summary?.realizedPnl, decimals)}>{fmtSigned(summary?.realizedPnl, decimals)}</Num>
          </Stat>
        </dl>
        <p className="mt-4 text-xs text-muted">
          Unrealized PnL covers perpetual positions. Option positions are priced from the pricing service and shown per position.
        </p>
      </div>

      <Panel
        title={
          <div role="tablist" aria-label="Portfolio sections" className="-mb-px flex h-9 gap-5">
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                type="button"
                aria-selected={tab === item.id}
                onClick={() => setTab(item.id)}
                className={cn(
                  "h-9 border-b px-0.5 text-sm font-medium",
                  tab === item.id ? "border-text text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                {item.label}
                {item.id === "orders" && waiting > 0 ? ` (${waiting})` : ""}
              </button>
            ))}
          </div>
        }
      >
        <div role="tabpanel" className="overflow-x-auto">
          {tab === "all" || tab === "perps" ? (
            <section aria-label="Perpetual positions">
              {tab === "all" ? <h3 className="px-3 pt-3 text-xs text-muted">Perpetuals</h3> : null}
              {perps.length === 0 ? <Empty>No open perpetual positions.</Empty> : <PerpPositionsTable positions={perps} decimals={decimals} />}
            </section>
          ) : null}
          {tab === "all" || tab === "options" ? (
            <section aria-label="Option positions" className={tab === "all" ? "border-t border-line" : undefined}>
              {tab === "all" ? <h3 className="px-3 pt-3 text-xs text-muted">Options</h3> : null}
              {(tab === "all" ? openOptions : options).length === 0 ? (
                <Empty>{tab === "all" ? "No open option positions." : "No option positions yet."}</Empty>
              ) : (
                <OptionPositionsTable positions={tab === "all" ? openOptions : options} />
              )}
            </section>
          ) : null}
          {tab === "orders" ? <OrdersTable /> : null}
          {tab === "funding" ? <FundingTable /> : null}
          {tab === "history" ? <HistoryTable /> : null}
        </div>
      </Panel>
    </div>
  );
}
