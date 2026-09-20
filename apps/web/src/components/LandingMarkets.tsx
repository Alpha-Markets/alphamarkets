"use client";

import { Num, Panel, Skeleton } from "@orionis/ui";
import Link from "next/link";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { Change, useStatsFor } from "./Change";

function Row({ symbol }: { symbol: string }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  return (
    <li>
      <Link
        href={`/perpetuals?market=${symbol}`}
        className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-6 px-4 py-3 hover:bg-raised/60 sm:grid-cols-[1fr_8rem_6rem_6rem]"
      >
        <span className="font-medium">{symbol}</span>
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
    <Panel title="Markets" actions={<Link href="/markets" className="text-sm underline underline-offset-2">All markets</Link>}>
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
