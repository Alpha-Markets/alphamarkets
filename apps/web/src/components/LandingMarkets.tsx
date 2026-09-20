"use client";

import { Num, Skeleton, chip, cn, rowLink } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { usePerpMarket, usePerpMarkets, usePriceHistory } from "@/hooks/queries";
import { PRICE_DECIMALS, fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { ArrowIcon } from "./ArrowIcon";
import { Change, useStatsFor } from "./Change";
import { Sparkline } from "./Sparkline";

/// Points kept for the sparkline; the indexer samples more than a small chart can show.
const SPARK_POINTS = 48;

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
      <Link
        href={`/perpetuals?market=${symbol}`}
        className={cn(rowLink, "grid grid-cols-[1fr_auto_auto_1rem] items-center gap-x-4 px-6 py-4 sm:grid-cols-[1fr_6rem_7rem_5rem_5rem_1rem] sm:px-[68px]")}
      >
        <span className="text-base">{symbol}</span>
        <Sparkline points={points} className="hidden h-7 w-full sm:block" />
        <Num className="text-right">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-14" />}</Num>
        <Change stats={stats} className="text-right" />
        <Num tone="muted" className="hidden text-right sm:block" title="Funding rate">
          {fmtBps(data?.funding.currentFundingRateBps)}
        </Num>
        <ArrowIcon className="size-3 text-muted" />
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
      <div className="flex items-center justify-between gap-3 px-6 pb-4 sm:px-[68px]">
        <h2 id="landing-markets" className="text-sm text-muted">
          Markets
        </h2>
        <Link href="/markets" className={cn(chip, "h-9 gap-2 rounded-lg px-3 text-[13px] font-medium uppercase tracking-[0.04em]")}>
          All markets
          <ArrowIcon />
        </Link>
      </div>
      {isPending ? (
        <p className="border-t border-line px-6 py-4 text-muted sm:px-[68px]">Loading markets…</p>
      ) : symbols.length === 0 ? (
        <p className="border-t border-line px-6 py-4 text-muted sm:px-[68px]">No perpetual markets are listed yet.</p>
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {symbols.map((symbol) => (
            <Row key={symbol} symbol={symbol} />
          ))}
        </ul>
      )}
    </section>
  );
}
