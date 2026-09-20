"use client";

import { Num, Panel, Skeleton, cn } from "@alphamarkets/ui";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { Change, useStatsFor } from "./Change";

/// Enough markets that finding one by eye is slower than typing part of its name.
const FILTER_FROM = 6;

function MarketRow({ symbol }: { symbol: string }) {
  const selected = useTerminal((state) => state.symbol === symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);

  return (
    <li>
      <button
        type="button"
        onClick={() => setSymbol(symbol)}
        aria-pressed={selected}
        className={cn(
          "grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 border-l-2 px-3 py-2 text-left",
          selected ? "border-accent bg-raised" : "border-transparent hover:bg-raised/60",
        )}
      >
        <span className="font-medium">{symbol}</span>
        <Num>{data ? fmtPrice(data.markPrice) : <Skeleton className="w-12" />}</Num>
        <Num tone="muted" className="text-xs" title="Funding rate">
          {fmtBps(data?.funding.currentFundingRateBps)}
        </Num>
        <Change stats={stats} className="text-xs" />
      </button>
    </li>
  );
}

/// Chooses the market to show: `?market=` when it names a listed one (links from the Markets page),
/// else the first the registry lists. It renders nothing, and sits in its own Suspense boundary
/// because reading the URL suspends; keeping that out of the list means the list hydrates together
/// with the rest of the page instead of after the market query has already answered.
export function MarketFromUrl() {
  const { data: markets } = usePerpMarkets();
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const requested = useSearchParams().get("market")?.toUpperCase();

  useEffect(() => {
    if (!markets?.length) return;
    const symbols = markets.map((market) => symbolOf(market.marketId));
    if (requested && symbols.includes(requested)) {
      if (symbol !== requested) setSymbol(requested);
    } else if (!symbol) {
      setSymbol(symbols[0]!);
    }
  }, [markets, symbol, requested, setSymbol]);

  return null;
}

export function MarketList() {
  const { data: markets, isPending, error } = usePerpMarkets();
  const [filter, setFilter] = useState("");
  const list = useRef<HTMLUListElement>(null);

  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  const shown = symbols.filter((value) => value.includes(filter.trim().toUpperCase()));

  // Up and Down walk the list without leaving the keyboard; Enter or Space then picks the market.
  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(list.current?.querySelectorAll("button") ?? []);
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[at + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  return (
    <Panel title="Markets" className="h-full">
      {symbols.length >= FILTER_FROM ? (
        <div className="border-b border-line p-2">
          <input
            type="search"
            aria-label="Filter markets"
            placeholder="Filter markets"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-9 w-full rounded-md border border-line bg-ground px-2 text-sm outline-none placeholder:text-faint focus:border-accent"
          />
        </div>
      ) : null}
      {isPending ? (
        <p className="p-3 text-muted">Loading markets…</p>
      ) : error ? (
        <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
      ) : symbols.length === 0 ? (
        <p className="p-3 text-muted">No perpetual markets are listed on the registry yet.</p>
      ) : shown.length === 0 ? (
        <p className="p-3 text-muted">No market matches “{filter}”.</p>
      ) : (
        <ul ref={list} onKeyDown={onKeyDown} className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((value) => (
            <MarketRow key={value} symbol={value} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
