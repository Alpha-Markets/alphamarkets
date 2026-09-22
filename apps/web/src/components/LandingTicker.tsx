"use client";

import { Num } from "@alphamarkets/ui";
import Link from "next/link";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { Change, useStatsFor } from "./Change";

/// A run should be wider than a wide screen so the loop never shows a gap; short lists repeat.
const MIN_ITEMS_PER_RUN = 8;

function Item({ symbol, hidden }: { symbol: string; hidden: boolean }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  return (
    <li>
      <Link
        href={`/perpetuals?market=${symbol}`}
        tabIndex={hidden ? -1 : undefined}
        className="flex h-11 items-center gap-3 rounded-control px-3 transition-colors duration-150 hover:bg-accent-soft hover:text-accent active:bg-accent active:text-accent-ink"
      >
        <span className="font-medium">{symbol}</span>
        {data ? <Num tone="muted">{`$${fmtPrice(data.markPrice)}`}</Num> : null}
        {stats ? <Change stats={stats} /> : null}
      </Link>
    </li>
  );
}

function Run({ symbols, hidden }: { symbols: string[]; hidden: boolean }) {
  return (
    <ul aria-hidden={hidden || undefined} className="flex shrink-0 items-center gap-4 pr-4">
      {symbols.map((symbol, index) => (
        <Item key={`${symbol}-${index}`} symbol={symbol} hidden={hidden} />
      ))}
    </ul>
  );
}

/// Every perpetual market with its price and 24h change, sliding past under the hero. It is a shortcut
/// into the terminal; the full table is further down the page.
export function LandingTicker() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  const run = symbols.length === 0 ? [] : Array.from({ length: Math.ceil(MIN_ITEMS_PER_RUN / symbols.length) }, () => symbols).flat();
  return (
    <div className="ticker flex h-[4.5rem] items-center overflow-hidden border-y border-line bg-ground text-sm" aria-label="Perpetual markets">
      {run.length === 0 ? (
        <p className="px-4 text-muted sm:px-6 lg:px-[32px]">{isPending ? "Loading markets…" : "No perpetual markets are listed yet."}</p>
      ) : (
        <div className="ticker-track flex w-max items-center">
          <Run symbols={run} hidden={false} />
          <Run symbols={run} hidden />
        </div>
      )}
    </div>
  );
}
