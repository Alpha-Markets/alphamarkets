"use client";

import { useQuery } from "@tanstack/react-query";
import { Num, Panel, Skeleton, Stat } from "@orionis/ui";
import Link from "next/link";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { fmtBps, fmtCountdown, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { orionisRead } from "@/lib/orionis";
import { Change, useStatsFor } from "./Change";
import { RiskLadder } from "./RiskLadder";

/// Example order priced for the ladder: 1,000 USD of collateral, long, at the middle leverage tier.
const EXAMPLE_COLLATERAL = "1000";
const EXAMPLE_LABEL = "1,000";

/// A live look at the first perpetual market with the one picture that says what the product is
/// for: how far the price can move against a position before it is liquidated. Every figure is
/// read from the chain and the same preview the order panel uses; nothing here is illustrative
/// except the size of the example order, which the caption states.
export function LandingHero() {
  const { data: markets } = usePerpMarkets();
  const symbol = markets?.[0] ? symbolOf(markets[0].marketId) : "";
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  const now = useNow();

  const tiers = data?.risk.allowedLeverageTiers ?? [];
  const leverage = tiers[Math.min(2, tiers.length - 1)];
  const example = useQuery({
    queryKey: ["landing-preview", symbol, String(leverage)],
    queryFn: () => orionisRead.perps.previewOpen({ market: symbol, side: "LONG", collateral: EXAMPLE_COLLATERAL, leverage: Number(leverage) }),
    enabled: Boolean(symbol && leverage),
    refetchInterval: 10_000,
    retry: false,
  });

  if (markets && markets.length === 0) return null;

  return (
    <Panel title={symbol ? `${symbol}-PERP` : "Perpetual market"} actions={symbol ? <Link href={`/perpetuals?market=${symbol}`} className="text-sm underline underline-offset-2">Trade {symbol}</Link> : undefined}>
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-baseline gap-3">
          <Num className="text-display font-light">{data ? fmtPrice(data.markPrice) : <Skeleton className="h-12 w-56" />}</Num>
          <Change stats={stats} className="text-base" />
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          <Stat label="Index price">{data ? fmtPrice(data.indexPrice) : <Skeleton className="w-14" />}</Stat>
          <Stat label="Funding rate">{data ? fmtBps(data.funding.currentFundingRateBps) : <Skeleton className="w-14" />}</Stat>
          <Stat label="Next funding">{data && now ? fmtCountdown(data.funding.nextFundingTimestamp, now) : <Skeleton className="w-14" />}</Stat>
          <Stat label="Max leverage">{data ? `${data.risk.maxLeverage}x` : <Skeleton className="w-10" />}</Stat>
        </dl>
        {example.data ? (
          <div>
            <RiskLadder isLong entry={example.data.entryPrice} liquidation={example.data.liquidationPrice} worst={example.data.worstPrice} />
            <p className="mt-2 text-xs text-muted">
              Example: a long with {EXAMPLE_LABEL} USD of collateral at {String(leverage)}x, priced now.
            </p>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
