"use client";

import { Panel, Skeleton, cn } from "@alphamarkets/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import type { MarketStats } from "@alphamarkets/sdk";
import type { MarketConfig } from "@alphamarkets/types";
import { useAllMarkets, useMarketOverviews, useMarketStats, useSettlementDecimals } from "@/hooks/queries";
import { env } from "@/lib/env";
import { fmt, fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { Change } from "./Change";

type Overview = ReturnType<typeof useMarketOverviews>[number]["data"];

type SortKey = "asset" | "index" | "change" | "optionsVolume" | "perpVolume" | "openInterest" | "funding";

/// Columns in order. `hide` names the screen width below which a column is dropped so the table
/// fits a phone; the row still opens the market.
const columns: Array<{ key: SortKey; label: string; hide?: string }> = [
  { key: "asset", label: "Asset" },
  { key: "index", label: "Index price" },
  { key: "change", label: "24h" },
  { key: "optionsVolume", label: "Options volume", hide: "max-md:hidden" },
  { key: "perpVolume", label: "Perp volume", hide: "max-md:hidden" },
  { key: "openInterest", label: "Open interest", hide: "max-md:hidden" },
  { key: "funding", label: "Funding", hide: "max-sm:hidden" },
];

const cell = "px-3 py-2.5 text-right tabular-nums first:text-left max-md:px-2";
const linkClass = "inline-flex h-8 items-center rounded-md border border-line px-2.5 text-xs font-medium hover:border-faint hover:bg-raised";

interface Line {
  market: MarketConfig;
  symbol: string;
  stats?: MarketStats;
  overview: Overview;
  loading: boolean;
}

/// A number to order by, or undefined when the figure is missing (those rows go last either way).
function sortValue(line: Line, key: SortKey): number | string | undefined {
  switch (key) {
    case "asset":
      return line.symbol;
    case "index":
      return line.overview?.prices ? Number(line.overview.prices.index.price) : undefined;
    case "change":
      return line.stats?.change24hBps ?? undefined;
    case "optionsVolume":
      return line.stats && line.market.optionsEnabled ? Number(line.stats.optionsVolume24h) : undefined;
    case "perpVolume":
      return line.stats && line.market.perpsEnabled ? Number(line.stats.perpVolume24h) : undefined;
    case "openInterest":
      return line.market.perpsEnabled && line.overview?.openInterest ? Number(line.overview.openInterest.total) : undefined;
    case "funding":
      return line.market.perpsEnabled && line.overview?.funding ? Number(line.overview.funding.currentFundingRateBps) : undefined;
  }
}

function sorted(lines: Line[], key: SortKey, direction: "asc" | "desc"): Line[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...lines].sort((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return (typeof x === "string" ? x.localeCompare(y as string) : x - (y as number)) * sign;
  });
}

/// A figure once it has loaded, a pulse while it loads, and a dash when this market has none.
function Figure({ loading, children }: { loading: boolean; children: ReactNode }) {
  return loading ? <Skeleton className="w-14" /> : (children ?? "–");
}

function MarketRow({ line, decimals }: { line: Line; decimals: number }) {
  const router = useRouter();
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { market, symbol, stats, overview, loading } = line;
  const perps = `/perpetuals?market=${symbol}`;

  return (
    <tr
      className={cn("border-t border-line", market.perpsEnabled && "cursor-pointer hover:bg-raised/60")}
      onClick={market.perpsEnabled ? () => router.push(perps) : undefined}
    >
      <td className={cell}>
        <div className="flex items-center gap-2">
          {market.perpsEnabled ? (
            <Link href={perps} className="font-medium hover:underline" onClick={(event) => event.stopPropagation()}>
              {symbol}
            </Link>
          ) : (
            <span className="font-medium">{symbol}</span>
          )}
          {market.active ? null : <span className="rounded-sm border border-down px-1 text-xs text-down">Paused</span>}
        </div>
        {market.optionsEnabled ? (
          <Link
            href="/options"
            onClick={(event) => {
              event.stopPropagation();
              setSymbol(symbol);
            }}
            className="mt-0.5 inline-block text-xs text-muted underline underline-offset-2 hover:text-text md:hidden"
          >
            Options
          </Link>
        ) : null}
      </td>
      <td className={cell}>
        <Figure loading={loading}>{fmtPrice(overview?.prices?.index.price)}</Figure>
      </td>
      <td className={cell}>
        <Change stats={stats} />
      </td>
      <td className={cn(cell, "max-md:hidden")}>{stats && market.optionsEnabled ? `$${fmt(stats.optionsVolume24h, decimals, 0)}` : "–"}</td>
      <td className={cn(cell, "max-md:hidden")}>{stats && market.perpsEnabled ? `$${fmt(stats.perpVolume24h, decimals, 0)}` : "–"}</td>
      <td className={cn(cell, "max-md:hidden")}>
        <Figure loading={loading && market.perpsEnabled}>
          {market.perpsEnabled && overview?.openInterest ? `$${fmt(overview.openInterest.total, decimals, 0)}` : "–"}
        </Figure>
      </td>
      <td className={cn(cell, "max-sm:hidden")}>
        <Figure loading={loading && market.perpsEnabled}>{market.perpsEnabled ? fmtBps(overview?.funding?.currentFundingRateBps) : "–"}</Figure>
      </td>
      <td className={cn(cell, "space-x-2 max-md:hidden")}>
        {market.optionsEnabled ? (
          <Link href="/options" onClick={(event) => { event.stopPropagation(); setSymbol(symbol); }} className={linkClass}>
            Trade options
          </Link>
        ) : null}
        {market.perpsEnabled ? (
          <Link href={perps} onClick={(event) => event.stopPropagation()} className={linkClass}>
            Trade perps
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/// Enough markets that finding one by eye is slower than typing part of its name.
const FILTER_FROM = 6;

/// PROJECT_BRIEF.md Section 29. Every market on the registry appears, so a market added by
/// configuration shows up here with no code change. IV is left out until the pricing service has
/// a live options market to quote it from.
export function MarketsTable() {
  const { data: markets, isPending, error } = useAllMarkets();
  const { data: stats, isError: statsUnavailable } = useMarketStats();
  const { data: decimals = 6 } = useSettlementDecimals();
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "asset", direction: "asc" });

  const symbols = useMemo(() => (markets ?? []).map((market) => symbolOf(market.marketId)), [markets]);
  const overviews = useMarketOverviews(symbols);
  const byId = new Map((stats ?? []).map((row) => [row.marketId, row]));

  const lines: Line[] = (markets ?? []).map((market, index) => ({
    market,
    symbol: symbols[index]!,
    stats: byId.get(market.marketId),
    overview: overviews[index]?.data,
    loading: overviews[index]?.isPending ?? true,
  }));
  const shown = sorted(
    lines.filter((line) => line.symbol.includes(filter.trim().toUpperCase())),
    sort.key,
    sort.direction,
  );

  function sortBy(key: SortKey) {
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : key === "asset" ? "asc" : "desc" }));
  }

  return (
    <Panel
      title="All markets"
      actions={
        symbols.length >= FILTER_FROM ? (
          <input
            type="search"
            aria-label="Filter markets"
            placeholder="Filter markets"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="my-1 h-8 w-44 rounded-md border border-line bg-ground px-2 text-sm outline-none placeholder:text-faint focus:border-text"
          />
        ) : null
      }
    >
      <div className="overflow-x-auto">
        {isPending ? (
          <p className="p-3 text-muted">Loading markets…</p>
        ) : error ? (
          <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
        ) : markets.length === 0 ? (
          <p className="p-3 text-muted">No markets are listed on the registry yet.</p>
        ) : shown.length === 0 ? (
          <p className="p-3 text-muted">No market matches “{filter}”.</p>
        ) : (
          <table className="w-full text-cell md:min-w-[900px]">
            <thead>
              <tr>
                {columns.map((column) => {
                  const active = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className={cn("px-3 py-1 text-right text-xs font-normal first:text-left max-md:px-2", column.hide)}
                    >
                      <button
                        type="button"
                        onClick={() => sortBy(column.key)}
                        className={cn("inline-flex h-8 items-center gap-1 whitespace-nowrap hover:text-text", active ? "text-text" : "text-muted")}
                      >
                        {column.label}
                        <span aria-hidden="true" className="w-2 text-[10px]">
                          {active ? (sort.direction === "asc" ? "▲" : "▼") : ""}
                        </span>
                      </button>
                    </th>
                  );
                })}
                <th className="max-md:hidden" />
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => (
                <MarketRow key={line.market.marketId} line={line} decimals={decimals} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!env.apiUrl ? (
        <p className="border-t border-line p-3 text-muted">
          24h change and volumes come from the indexer. Set NEXT_PUBLIC_API_URL to show them.
        </p>
      ) : statsUnavailable ? (
        <p className="border-t border-line p-3 text-down">The statistics service is not responding, so 24h change and volumes are hidden.</p>
      ) : (
        <p className="border-t border-line p-3 text-xs text-muted">
          Volumes are for the last 24 hours, in USD. Options volume is the premium paid on new positions.
        </p>
      )}
    </Panel>
  );
}
