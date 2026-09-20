"use client";

import { Num, Panel, Segmented, Stat, Tabs } from "@orionis/ui";
import type { OpenInterestRange } from "@orionis/sdk";
import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import {
  useMarketFundingHistory,
  useOpenInterestHistory,
  useOpenInterestNow,
  usePerpMarket,
  usePositions,
  useSettlementDecimals,
} from "@/hooks/queries";
import {
  allFundingZero,
  averageFunding,
  longSharePercent,
  toFundingBars,
  toOiChartPoints,
  utilizationBps,
  type FundingBar,
  type OiChartPoint,
} from "@/lib/analytics";
import { env } from "@/lib/env";
import { fmtBps, fmtUsd } from "@/lib/format";
import { fmtDateTime } from "@/lib/options";
import { useTerminal } from "@/stores/terminal";
import { PerpPositionsTable } from "./PositionsTable";

const W = 1000;
const H = 140;

const needsApi = (what: string) => <p className="p-3 text-muted">{what} come from the indexer. Set NEXT_PUBLIC_API_URL to show them.</p>;

const fmtPercent = (value: number) => `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(4)}%`;

/// Funding rate per interval as bars around a zero line: up is longs paying shorts, down is
/// shorts paying longs.
function FundingBars({ bars }: { bars: FundingBar[] }) {
  const peak = Math.max(...bars.map((bar) => Math.abs(bar.percent)), 0.0001);
  const slot = W / Math.max(bars.length, 40);
  const mid = H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Funding rate per interval">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="currentColor" className="text-line" vectorEffect="non-scaling-stroke" />
      {bars.map((bar, index) => {
        const height = (Math.abs(bar.percent) / peak) * (mid - 4);
        const x = W - (bars.length - index) * slot + slot * 0.15;
        return (
          <rect
            key={bar.time}
            x={x}
            y={bar.percent >= 0 ? mid - height : mid}
            width={slot * 0.7}
            height={Math.max(height, bar.percent === 0 ? 0 : 1)}
            fill="currentColor"
            className={bar.percent >= 0 ? "text-up" : "text-down"}
          />
        );
      })}
    </svg>
  );
}

function FundingHistory() {
  const symbol = useTerminal((state) => state.symbol);
  const { data: market } = usePerpMarket(symbol);
  const { data, isPending, isError } = useMarketFundingHistory(symbol);
  const bars = useMemo(() => toFundingBars(data ?? []), [data]);
  const average = averageFunding(bars);

  if (!env.apiUrl) return needsApi("Funding rates");
  if (isError) return <p className="p-3 text-down">The funding history is not available right now.</p>;
  if (isPending) return <p className="p-3 text-muted">Loading funding…</p>;

  return (
    <div className="flex flex-col gap-3 p-3">
      <dl className="flex flex-wrap gap-x-10 gap-y-2">
        <Stat label="Current rate">{fmtBps(market?.funding.currentFundingRateBps)}</Stat>
        <Stat label={`Average, last ${bars.length} intervals`}>{average === undefined ? "–" : fmtPercent(average)}</Stat>
        <Stat label="Interval">{market ? `${Number(market.funding.fundingIntervalSeconds) / 3600}h` : "–"}</Stat>
      </dl>
      {bars.length === 0 ? (
        <p className="text-muted">No funding has been applied yet. The first rate is recorded after one interval with an open position.</p>
      ) : (
        <>
          <FundingBars bars={bars} />
          <p className="text-xs text-muted">
            Bars above the line mean longs paid shorts; below, shorts paid longs. Latest {fmtDateTime(new Date(bars.at(-1)!.time * 1000).toISOString())}.
          </p>
          {allFundingZero(bars) ? (
            <p className="text-xs text-muted">
              Every interval so far is 0%. Funding follows the gap between the mark and index price, and the protocol has no separate mark price yet, so they are equal.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/// Long and short open interest over time as two lines on one scale.
function OpenInterestLines({ points }: { points: OiChartPoint[] }) {
  const peak = Math.max(...points.flatMap((point) => [point.long, point.short]), 1);
  const x = (index: number) => (points.length < 2 ? 0 : (index / (points.length - 1)) * W);
  const y = (value: number) => H - 6 - (value / peak) * (H - 12);
  const line = (pick: (point: OiChartPoint) => number) => points.map((point, index) => `${x(index)},${y(pick(point))}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full" role="img" aria-label="Open interest over time">
      <polyline fill="none" stroke="currentColor" strokeWidth={1.5} className="text-up" vectorEffect="non-scaling-stroke" points={line((p) => p.long)} />
      <polyline fill="none" stroke="currentColor" strokeWidth={1.5} className="text-down" vectorEffect="non-scaling-stroke" points={line((p) => p.short)} />
    </svg>
  );
}

function OpenInterestAnalytics() {
  const symbol = useTerminal((state) => state.symbol);
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: now } = useOpenInterestNow(symbol);
  const [range, setRange] = useState<OpenInterestRange>("7d");
  const { data, isError } = useOpenInterestHistory(symbol, range);
  const points = useMemo(() => toOiChartPoints(data ?? [], decimals), [data, decimals]);

  const share = now ? longSharePercent(now.long, now.short) : undefined;
  const used = now ? utilizationBps(now.total, now.cap) : undefined;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-2">
        <dl className="flex flex-wrap gap-x-10 gap-y-2">
          <Stat label="Long">
            <Num tone="up">{fmtUsd(now?.long, decimals, 0)}</Num>
          </Stat>
          <Stat label="Short">
            <Num tone="down">{fmtUsd(now?.short, decimals, 0)}</Num>
          </Stat>
          <Stat label="Long share">{share === undefined ? "–" : `${share}%`}</Stat>
          <Stat label="Cap used">{used === undefined ? "–" : `${(used / 100).toFixed(2)}% of ${fmtUsd(now?.cap, decimals, 0)}`}</Stat>
        </dl>
        {env.apiUrl && !isError ? (
          <div className="ml-auto w-44">
            <Segmented
              label="Range"
              value={range}
              onChange={setRange}
              options={(["24h", "7d", "30d"] as const).map((value) => ({ value, label: value }))}
            />
          </div>
        ) : null}
      </div>
      {!env.apiUrl ? (
        needsApi("The open interest history")
      ) : isError ? (
        <p className="text-down">The open interest history is not available right now.</p>
      ) : (
        <>
          {points.length < 2 ? <p className="text-muted">Not enough history yet.</p> : <OpenInterestLines points={points} />}
          <p className="text-xs text-muted">
            <span className="text-up">Green</span> is long open interest, <span className="text-down">red</span> is short. The chart is
            rebuilt from the indexed perpetual position events. The figures above come from the chain and also count open option
            notional, since options share the same cap.
          </p>
        </>
      )}
    </div>
  );
}

type Tab = "positions" | "funding" | "interest";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "positions", label: "Positions" },
  { id: "funding", label: "Funding" },
  { id: "interest", label: "Open interest" },
];

function PositionsBody() {
  const { isConnected } = useAccount();
  const { data, isPending } = usePositions();
  const { data: decimals = 6 } = useSettlementDecimals();
  const open = data?.perps.filter((position) => position.open) ?? [];

  if (!isConnected) return <p className="p-3 text-muted">Connect a wallet to see your positions.</p>;
  if (isPending) return <p className="p-3 text-muted">Loading positions…</p>;
  if (open.length === 0) return <p className="p-3 text-muted">No open positions. Deposit collateral and open one from the order panel.</p>;
  return <PerpPositionsTable positions={open} decimals={decimals} />;
}

/// The strip under the chart: the wallet's positions, and the market's funding and open interest.
export function MarketAnalytics() {
  const [tab, setTab] = useState<Tab>("positions");
  const { data } = usePositions();
  const count = data?.perps.filter((position) => position.open).length ?? 0;
  const tabList = TABS.map((item) => (item.id === "positions" && count > 0 ? { ...item, label: `${item.label} (${count})` } : item));

  return (
    <Panel
      className="h-64 shrink-0"
      title={<Tabs label="Market sections" tabs={tabList} value={tab} onChange={setTab} />}
    >
      <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
        {tab === "positions" ? <PositionsBody /> : tab === "funding" ? <FundingHistory /> : <OpenInterestAnalytics />}
      </div>
    </Panel>
  );
}
