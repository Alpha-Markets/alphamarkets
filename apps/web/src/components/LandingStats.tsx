"use client";

import { cn } from "@alphamarkets/ui";
import { useMemo } from "react";
import { useAllMarkets, useMarketOverviews, useMarketStats, usePerpMarkets, useSettlementDecimals } from "@/hooks/queries";
import { fmtCompactUsd } from "@/lib/format";
import { PAGE_FRAME } from "@/lib/frame";
import { symbolOf } from "@/lib/market";

function Figure({ label, className, children }: { label: string; className?: string; children: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col-reverse justify-end gap-2 py-6 sm:py-10", className)}>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-serif text-[2.25rem] font-light leading-none tracking-[-0.03em] tabular-nums sm:text-[3.25rem]">{children}</dd>
    </div>
  );
}

/// Four totals for the whole venue, read from the same sources as the Markets page: the indexer for
/// 24h volume, the chain for open interest and the registry for how many markets trade what. A total
/// that has not loaded, or that the indexer is off for, shows a dash rather than a guess.
export function LandingStats() {
  const { data: decimals } = useSettlementDecimals();
  const { data: stats } = useMarketStats();
  const { data: markets } = useAllMarkets();
  const { data: perps } = usePerpMarkets();
  const symbols = useMemo(() => (perps ?? []).map((market) => symbolOf(market.marketId)), [perps]);
  const overviews = useMarketOverviews(symbols);

  const volume = stats && decimals !== undefined ? stats.reduce((sum, row) => sum + row.perpVolume24h + row.optionsVolume24h, 0n) : undefined;
  const settled = overviews.length > 0 && overviews.every((query) => query.data);
  const openInterest =
    settled && decimals !== undefined ? overviews.reduce((sum, query) => sum + (query.data?.openInterest?.total ?? 0n), 0n) : undefined;

  return (
    <dl className="border-b border-line">
      <div className={cn(PAGE_FRAME, "grid grid-cols-2 sm:grid-cols-4")}>
        <Figure label="24h volume">{fmtCompactUsd(volume, decimals ?? 0)}</Figure>
        <Figure label="Open interest" className="border-l border-line pl-4 sm:pl-6">
          {fmtCompactUsd(openInterest, decimals ?? 0)}
        </Figure>
        <Figure label="Perpetual markets" className="max-sm:border-t max-sm:border-line sm:border-l sm:border-line sm:pl-6">
          {markets ? String(markets.filter((market) => market.perpsEnabled).length) : "–"}
        </Figure>
        <Figure label="Option markets" className="border-l border-line pl-4 max-sm:border-t sm:pl-6">
          {markets ? String(markets.filter((market) => market.optionsEnabled).length) : "–"}
        </Figure>
      </div>
    </dl>
  );
}
