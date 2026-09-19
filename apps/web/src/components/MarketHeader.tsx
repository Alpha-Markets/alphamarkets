"use client";

import { Num, Stat } from "@orionis/ui";
import { useNow } from "@/hooks/useNow";
import { usePerpMarket } from "@/hooks/queries";
import { fmtBps, fmtCountdown, fmtPrice } from "@/lib/format";
import { useTerminal } from "@/stores/terminal";

export function MarketHeader() {
  const symbol = useTerminal((state) => state.symbol);
  const { data } = usePerpMarket(symbol);
  const now = useNow();

  return (
    <div className="flex h-16 shrink-0 items-center gap-8 border border-line bg-surface px-4">
      <h1 className="text-lg font-medium">{symbol ? `${symbol}-PERP` : "–"}</h1>
      <dl className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-1">
        <Stat label="Mark">
          <Num className="text-base">{fmtPrice(data?.markPrice)}</Num>
        </Stat>
        <Stat label="Index">{fmtPrice(data?.indexPrice)}</Stat>
        <Stat label="Funding rate">{fmtBps(data?.funding.currentFundingRateBps)}</Stat>
        <Stat label="Next funding">
          {data && now ? fmtCountdown(data.funding.nextFundingTimestamp, now) : "–"}
        </Stat>
        <Stat label="Max leverage">{data ? `${data.risk.maxLeverage}x` : "–"}</Stat>
      </dl>
    </div>
  );
}
