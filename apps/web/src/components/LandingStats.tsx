"use client";

import { cn } from "@alphamarkets/ui";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useAllMarkets, useMarketOverviews, useMarketStats, usePerpMarkets, useSettlementDecimals } from "@/hooks/queries";
import { fmtCompact } from "@/lib/format";
import { PAGE_FRAME } from "@/lib/frame";
import { symbolOf } from "@/lib/market";
import { CountUp } from "./CountUp";

function Figure({ label, value, format }: { label: string; value: number | undefined; format: (n: number) => string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-2">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-serif text-[2.25rem] font-light leading-none tracking-[-0.03em] tabular-nums sm:text-[3.25rem]">
        <CountUp value={value} format={format} />
      </dd>
    </div>
  );
}

/// Four totals for the whole venue, read from the same sources as the Markets page: the indexer for
/// 24h volume, the chain for open interest and the registry for how many markets trade what. A total
/// that has not loaded, or that the indexer is off for, shows a dash rather than a guess. Each counts
/// up from 0 the first time it scrolls into view (`CountUp`) — a score tally for the venue's own
/// numbers, not a plain appearance. Nested directly under `LandingMarkets`'s own `SectionHeader`
/// (which already pads its own bottom), so this carries no top padding of its own — only the bottom
/// gap that separates it from the market-card grid below.
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

  const volumeNumber = volume !== undefined ? Number(formatUnits(volume, decimals ?? 0)) : undefined;
  const openInterestNumber = openInterest !== undefined ? Number(formatUnits(openInterest, decimals ?? 0)) : undefined;
  const perpCount = markets ? markets.filter((market) => market.perpsEnabled).length : undefined;
  const optionCount = markets ? markets.filter((market) => market.optionsEnabled).length : undefined;

  return (
    <dl className={cn(PAGE_FRAME, "pb-10 lg:pb-12")}>
      <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4 sm:gap-x-10">
        <Figure label="24h volume" value={volumeNumber} format={(n) => `$${fmtCompact(n)}`} />
        <Figure label="Open interest" value={openInterestNumber} format={(n) => `$${fmtCompact(n)}`} />
        <Figure label="Perpetual markets" value={perpCount} format={(n) => String(Math.round(n))} />
        <Figure label="Option markets" value={optionCount} format={(n) => String(Math.round(n))} />
      </div>
    </dl>
  );
}
