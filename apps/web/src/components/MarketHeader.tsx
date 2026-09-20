"use client";

import { Num, Skeleton, Stat } from "@orionis/ui";
import { useNow } from "@/hooks/useNow";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtBps, fmtCountdown, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { Change, useStatsFor } from "./Change";

/// The market's identity and the one number that matters most, the mark price, set large. Under
/// 1280px the market list is not on screen, so a picker here takes its place.
export function MarketHeader() {
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { data } = usePerpMarket(symbol);
  const { data: markets } = usePerpMarkets();
  const stats = useStatsFor(symbol);
  const now = useNow();

  return (
    <div className="flex shrink-0 flex-col gap-3 rounded-[10px] border border-line/70 bg-surface p-3 lg:flex-row lg:items-center lg:gap-8 lg:px-4">
      <div className="flex items-center justify-between gap-3 xl:block">
        <h1 className="text-title font-normal">{symbol ? `${symbol}-PERP` : "–"}</h1>
        {markets && markets.length > 1 ? (
          <label className="xl:hidden">
            <span className="sr-only">Market</span>
            <select
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              className="h-9 rounded-md border border-line bg-ground px-2 text-sm"
            >
              {markets.map((market) => {
                const value = symbolOf(market.marketId);
                return (
                  <option key={market.marketId} value={value}>
                    {value}
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
      </div>
      <div className="flex items-baseline gap-3">
        <Num className="text-figure font-light">{data ? fmtPrice(data.markPrice) : <Skeleton className="h-7 w-32" />}</Num>
        <Change stats={stats} className="text-sm" />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap sm:gap-x-8 lg:flex-1">
        <Stat label="Index price">{data ? fmtPrice(data.indexPrice) : <Skeleton className="w-14" />}</Stat>
        <Stat label="Funding rate">{data ? fmtBps(data.funding.currentFundingRateBps) : <Skeleton className="w-14" />}</Stat>
        <Stat label="Next funding">{data && now ? fmtCountdown(data.funding.nextFundingTimestamp, now) : <Skeleton className="w-14" />}</Stat>
        <Stat label="Max leverage">{data ? `${data.risk.maxLeverage}x` : <Skeleton className="w-10" />}</Stat>
      </dl>
    </div>
  );
}
