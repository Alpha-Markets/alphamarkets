"use client";

import { Num, Skeleton, chip, cn, rowLink } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { usePerpMarket, usePerpMarkets, usePriceHistory } from "@/hooks/queries";
import { PRICE_DECIMALS, fmtBps, fmtPrice } from "@/lib/format";
import { PAGE_FRAME } from "@/lib/frame";
import { symbolOf } from "@/lib/market";
import { ArrowIcon } from "./ArrowIcon";
import { Change, useStatsFor } from "./Change";
import { SectionHeader } from "./SectionHeader";
import { Sparkline } from "./Sparkline";

/// Points kept for the sparkline; the indexer samples more than a small chart can show.
const SPARK_POINTS = 48;

/// One grid for the column labels and every row, so they line up. A phone shows the market, price and
/// change; the chart and funding come in from `sm`, and the wide layout gives the chart the room.
const ROW_GRID =
  "grid grid-cols-[1fr_auto_auto_1rem] items-center gap-x-4 sm:grid-cols-[1fr_7rem_8rem_6rem_6rem_1rem] lg:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_9rem_8rem_8rem_1.5rem] lg:gap-x-8";

function Row({ symbol }: { symbol: string }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  const { data: history } = usePriceHistory(symbol, "24h");
  const points = useMemo(() => {
    const all = (history ?? []).map((point) => Number(formatUnits(point.price, PRICE_DECIMALS)));
    const step = Math.max(1, Math.floor(all.length / SPARK_POINTS));
    return all.filter((_, index) => index % step === 0 || index === all.length - 1);
  }, [history]);
  return (
    <li>
      <Link href={`/perpetuals?market=${symbol}`} className={cn(rowLink, "block")}>
        <div className={cn(PAGE_FRAME, ROW_GRID, "py-[18px] sm:py-[24px]")}>
          <span className="text-[1.5rem] font-light tracking-[-0.02em]">{symbol}</span>
          <Sparkline points={points} className="hidden h-10 w-full sm:block" />
          <Num className="text-right text-xl">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-14" />}</Num>
          <Change stats={stats} className="text-right" />
          <Num tone="muted" className="hidden text-right sm:block" title="Funding rate">
            {fmtBps(data?.funding.currentFundingRateBps)}
          </Num>
          <ArrowIcon className="size-3 text-muted" />
        </div>
      </Link>
    </li>
  );
}

/// Every perpetual market with its price, 24h change and funding, each a link into the terminal.
export function LandingMarkets() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  return (
    <section aria-labelledby="landing-markets">
      <SectionHeader
        id="landing-markets"
        title="Markets"
        action={
          <Link href="/markets" className={cn(chip, "h-9 shrink-0 gap-2 rounded-lg px-3 text-[13px] font-medium uppercase tracking-[0.04em]")}>
            All markets
            <ArrowIcon />
          </Link>
        }
      />
      {isPending ? (
        <p className={cn(PAGE_FRAME, "border-t border-line py-4 text-muted")}>Loading markets…</p>
      ) : symbols.length === 0 ? (
        <p className={cn(PAGE_FRAME, "border-t border-line py-4 text-muted")}>No perpetual markets are listed yet.</p>
      ) : (
        <>
          <div aria-hidden="true" className="hidden border-t border-line sm:block">
            <div className={cn(PAGE_FRAME, ROW_GRID, "py-3 text-xs text-muted")}>
              <span>Market</span>
              <span>Last 24 hours</span>
              <span className="text-right">Price</span>
              <span className="text-right">24h change</span>
              <span className="text-right">Funding</span>
              <span />
            </div>
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {symbols.map((symbol) => (
              <Row key={symbol} symbol={symbol} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
