"use client";

import { useMemo } from "react";
import { useAllMarkets, useMarketOverviews, useMarketStats, usePerpMarkets, useSettlementDecimals } from "@/hooks/queries";
import { fmtCompactUsd } from "@/lib/format";
import { symbolOf } from "@/lib/market";

function Figure({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end gap-0.5 py-5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-title tabular-nums">{children}</dd>
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
    <dl className="grid grid-cols-2 gap-x-6 border-b border-line px-6 sm:grid-cols-4 sm:px-[68px]">
      <Figure label="24h volume">{fmtCompactUsd(volume, decimals ?? 0)}</Figure>
      <Figure label="Open interest">{fmtCompactUsd(openInterest, decimals ?? 0)}</Figure>
      <Figure label="Perpetual markets">{markets ? String(markets.filter((market) => market.perpsEnabled).length) : "–"}</Figure>
      <Figure label="Option markets">{markets ? String(markets.filter((market) => market.optionsEnabled).length) : "–"}</Figure>
    </dl>
  );
}
