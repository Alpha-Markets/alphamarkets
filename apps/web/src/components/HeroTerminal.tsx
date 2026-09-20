"use client";

import { Num, Skeleton, Stat, cn, chip, pill } from "@alphamarkets/ui";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";
import { usePerpMarket, usePerpMarkets, usePriceHistory } from "@/hooks/queries";
import { PRICE_DECIMALS, fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { ArrowIcon } from "./ArrowIcon";
import { Change, useStatsFor } from "./Change";

/// Points kept for the chart; the indexer samples more than a card can show.
const CHART_POINTS = 60;

/// Drawn only while a market has no price history yet, and labelled as a sample when it is.
const SAMPLE = [0.38, 0.42, 0.4, 0.47, 0.44, 0.52, 0.49, 0.58, 0.54, 0.63, 0.6, 0.68, 0.65, 0.74, 0.71, 0.8];

/// A smooth line through the points, on a 100 x 40 canvas with a margin above and below.
function linePath(values: number[]): string {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * 100, 35 - ((value - min) / span) * 30] as const);
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!;
    const [x1, y1] = points[i]!;
    d += ` Q${x0} ${y0} ${(x0 + x1) / 2} ${(y0 + y1) / 2}`;
  }
  const [lx, ly] = points[points.length - 1]!;
  return `${d} L${lx} ${ly}`;
}

/// The chart for one market: real history when the indexer has it, the sample curve until then.
function Chart({ symbol }: { symbol: string }) {
  const { data: history } = usePriceHistory(symbol, "24h");
  const prices = useMemo(() => {
    const all = (history ?? []).map((point) => Number(formatUnits(point.price, PRICE_DECIMALS)));
    const step = Math.max(1, Math.floor(all.length / CHART_POINTS));
    return all.filter((_, index) => index % step === 0 || index === all.length - 1);
  }, [history]);
  const real = prices.length >= 2 && Math.max(...prices) > Math.min(...prices);
  const d = useMemo(() => linePath(real ? prices : SAMPLE), [real, prices]);

  return (
    <div className="relative h-[clamp(10rem,22dvh,15rem)]">
      {/* Keyed by market so the line draws in again when the market changes. */}
      <svg key={symbol} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" className="hero-chart absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="hero-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[10, 20, 30].map((y) => (
          <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="var(--color-line)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${d} L100 40 L0 40 Z`} fill="url(#hero-chart-fill)" opacity={real ? 1 : 0.55} />
        <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" opacity={real ? 1 : 0.6} />
      </svg>
      <p className="absolute bottom-3 left-5 text-xs text-faint">{real ? "Last 24 hours" : "Sample chart"}</p>
    </div>
  );
}

/// The selected market's price, 24h move and funding, with its chart under it.
function Quote({ symbol }: { symbol: string }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-5 pt-5">
        <div>
          <p className="text-xs text-muted">{symbol}-PERP mark price</p>
          <div className="mt-1 flex items-baseline gap-3">
            <Num className="text-[2.5rem] font-light leading-none tracking-[-0.03em]">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-32" />}</Num>
            {stats ? <Change stats={stats} className="text-sm" /> : null}
          </div>
        </div>
        <Stat label="Funding rate" className="text-right">
          {fmtBps(data?.funding.currentFundingRateBps)}
        </Stat>
      </div>
      <div className="mt-4">
        <Chart symbol={symbol} />
      </div>
    </>
  );
}

/// A floating preview of the terminal for the landing hero: pick a market, see its live price and
/// chart, and open it. It reads the same queries as the terminal, so what it shows is what the
/// terminal shows.
export function HeroTerminal() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId));
  const [picked, setPicked] = useState<string>();
  const symbol = picked && symbols.includes(picked) ? picked : symbols[0];

  return (
    <div className="relative w-full max-w-[44rem] justify-self-end">
      <span aria-hidden="true" className="pointer-events-none absolute -inset-12 bg-[radial-gradient(closest-side,rgb(58_219_208/0.14),transparent)]" />
      <section
        aria-label="Terminal preview"
        className="relative overflow-hidden rounded-[14px] border border-line bg-surface shadow-[0_40px_90px_-30px_rgb(0_0_0/0.75)]"
      >
        <div className="flex gap-1.5 overflow-x-auto border-b border-line p-3">
          {symbols.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={item === symbol}
              onClick={() => setPicked(item)}
              className={cn("h-9 shrink-0 rounded-lg px-3.5 text-sm", pill(item === symbol))}
            >
              {item}
            </button>
          ))}
          {symbols.length === 0 ? <p className="px-2 py-2 text-sm text-muted">{isPending ? "Loading markets…" : "No perpetual markets are listed yet."}</p> : null}
        </div>
        {symbol ? (
          <Quote symbol={symbol} />
        ) : (
          <div className="h-[clamp(14rem,30dvh,21rem)]" />
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-sm text-muted">Prices come straight from the chain.</p>
          {symbol ? (
            <Link href={`/perpetuals?market=${symbol}`} className={cn(chip, "h-9 shrink-0 gap-2 rounded-lg px-3.5 text-[13px] font-medium uppercase tracking-[0.04em]")}>
              Open {symbol}
              <ArrowIcon />
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
