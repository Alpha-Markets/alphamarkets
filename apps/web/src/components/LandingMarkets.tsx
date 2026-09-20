"use client";

import { Num, Panel, Skeleton, chip, cn } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { usePerpMarket, usePerpMarkets, usePriceHistory } from "@/hooks/queries";
import { PRICE_DECIMALS, fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
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
        className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 px-5 py-4 transition-colors duration-150 hover:bg-accent-soft hover:shadow-[inset_3px_0_0_var(--color-accent)] active:bg-accent-soft/60 sm:grid-cols-[1fr_7rem_8rem_6rem_6rem]"
      >
        <span className="text-base">{symbol}</span>
        <Sparkline points={points} className="hidden h-7 w-full sm:block" />
        <Num className="text-right">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-14" />}</Num>
        <Change stats={stats} className="text-right" />
        <Num tone="muted" className="hidden text-right sm:block" title="Funding rate">
          {fmtBps(data?.funding.currentFundingRateBps)}
        </Num>
      </Link>
    </li>
  );
}

/// Every perpetual market with its price, 24h change and funding, each a link into the terminal.
export function LandingMarkets() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  return (
    <Panel title="Markets" actions={<Link href="/markets" className={cn(chip, "h-8 px-2.5 text-xs font-medium")}>All markets</Link>}>
      {isPending ? (
        <p className="p-4 text-muted">Loading markets…</p>
      ) : symbols.length === 0 ? (
        <p className="p-4 text-muted">No perpetual markets are listed yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {symbols.map((symbol) => (
            <Row key={symbol} symbol={symbol} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
