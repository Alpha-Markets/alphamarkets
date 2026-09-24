"use client";

import { Num, Skeleton, chip, cn } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import type { MarketStats } from "@alphamarkets/sdk";
import { useMarketOverviews, useMarketStats, usePerpMarkets, usePriceHistory, useSettlementDecimals } from "@/hooks/queries";
import { PRICE_DECIMALS, fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import { CHIP_LABEL, PAGE_FRAME } from "@/lib/frame";
import { symbolOf } from "@/lib/market";
import { ArrowIcon } from "./ArrowIcon";
import { Change, useStatsFor } from "./Change";
import { LandingStats } from "./LandingStats";
import { SectionHeader } from "./SectionHeader";
import { Sparkline } from "./Sparkline";

/// Points kept for the sparkline; the indexer samples more than a small chart can show.
const SPARK_POINTS = 48;

type Overview = ReturnType<typeof useMarketOverviews>[number]["data"];

interface CardProps {
  symbol: string;
  overview: Overview;
  stats: MarketStats | undefined;
  decimals: number;
}

/// One market's price, chart and figures — a card in the same grid the Smart contracts section
/// uses (`rounded-panel`, border on hover only), not a table row: open interest, volume and funding
/// no longer need to hide behind a breakpoint to fit, they're just the card's own bottom row.
function MarketCard({ symbol, overview, stats, decimals }: CardProps) {
  const changeStats = useStatsFor(symbol);
  const { data: history } = usePriceHistory(symbol, "24h");
  const points = useMemo(() => {
    const all = (history ?? []).map((point) => Number(formatUnits(point.price, PRICE_DECIMALS)));
    const step = Math.max(1, Math.floor(all.length / SPARK_POINTS));
    return all.filter((_, index) => index % step === 0 || index === all.length - 1);
  }, [history]);
  return (
    <Link
      href={`/perpetuals?market=${symbol}`}
      className="group flex flex-col gap-4 rounded-panel border border-transparent bg-surface p-6 transition-colors duration-150 hover:border-accent hover:bg-accent-soft/20 lg:p-7"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[1.5rem] font-light tracking-[-0.02em] transition-colors duration-150 group-hover:text-accent">{symbol}</span>
        <ArrowIcon className="size-3 text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
      </div>
      <Sparkline points={points} className="h-12 w-full" />
      <div className="flex items-baseline justify-between gap-3">
        <Num className="text-xl">{overview?.prices ? fmtPrice(overview.prices.mark.price) : <Skeleton className="w-14" />}</Num>
        <Change stats={changeStats} />
      </div>
      <div className="mt-auto grid grid-cols-3 gap-3 pt-2 text-sm">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-muted">Open interest</span>
          <span className="truncate tabular-nums text-muted">{overview?.openInterest ? fmtUsd(overview.openInterest.total, decimals, 0) : "–"}</span>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-muted">24h volume</span>
          <span className="truncate tabular-nums text-muted">{stats ? fmtUsd(stats.perpVolume24h, decimals, 0) : "–"}</span>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-xs text-muted">Funding</span>
          <span className="truncate tabular-nums text-muted" title="Funding rate">
            {fmtBps(overview?.funding?.currentFundingRateBps)}
          </span>
        </div>
      </div>
    </Link>
  );
}

/// Every perpetual market with its price, 24h change, open interest, 24h volume and funding, each a
/// card into the terminal — the same grid the Smart contracts section uses, so the two read as one
/// system instead of a table next to a card list.
export function LandingMarkets() {
  const { data: markets, isPending } = usePerpMarkets();
  const { data: stats } = useMarketStats();
  const { data: decimals = 6 } = useSettlementDecimals();
  const symbols = useMemo(() => (markets ?? []).map((market) => symbolOf(market.marketId)), [markets]);
  const overviews = useMarketOverviews(symbols);
  const statsById = useMemo(() => new Map((stats ?? []).map((row) => [row.marketId, row])), [stats]);
  return (
    <section aria-labelledby="landing-markets">
      <SectionHeader
        id="landing-markets"
        title="Markets"
        action={
          <Link href="/markets" className={cn(chip, CHIP_LABEL, "h-9 shrink-0 gap-2 rounded-control px-3")}>
            All markets
            <ArrowIcon />
          </Link>
        }
      />
      <LandingStats />
      {isPending ? (
        <p className={cn(PAGE_FRAME, "py-4 text-muted")}>Loading markets…</p>
      ) : symbols.length === 0 ? (
        <p className={cn(PAGE_FRAME, "py-4 text-muted")}>No perpetual markets are listed yet.</p>
      ) : (
        <div className={cn(PAGE_FRAME, "mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
          {markets!.map((market, index) => (
            <MarketCard
              key={market.marketId}
              symbol={symbols[index]!}
              overview={overviews[index]?.data}
              stats={statsById.get(market.marketId)}
              decimals={decimals}
            />
          ))}
        </div>
      )}
    </section>
  );
}
