"use client";

import { Panel, Segmented, chip, cn } from "@alphamarkets/ui";
import type { CandleInterval } from "@alphamarkets/sdk";
import dynamic from "next/dynamic";
import { formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
import { useCandles, usePerpMarket, usePositions, usePriceHistory, useSettlementDecimals } from "@/hooks/queries";
import { candleTimeLabel, mergeSeries, toCandlePoints, type CandlePoint } from "@/lib/chart";
import { env } from "@/lib/env";
import { PRICE_DECIMALS, fmtCompact } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { margin } from "@alphamarkets/sdk";
import type { ChartLevel } from "./TradingChart";

/// The chart library is large and only this page uses it, so it loads when the page does, not with the app.
const TradingChart = dynamic(() => import("./TradingChart").then((module) => module.TradingChart), {
  ssr: false,
  loading: () => <p className="text-muted">Loading chart…</p>,
});

/// Live mark-price samples kept on top of the stored history.
const MAX_LIVE_POINTS = 300;

type Mode = "line" | "candles";
const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "1d"];

const toNumber = (value: bigint) => Number(formatUnits(value, PRICE_DECIMALS));

/// The open, high, low, close and volume of the candle under the cursor (the newest one when the
/// cursor is elsewhere), laid over the top-left corner of the chart.
function CandleReadout({ candle, interval }: { candle: CandlePoint; interval: CandleInterval }) {
  return (
    <p className="pointer-events-none absolute left-0 top-0 z-10 flex flex-wrap gap-x-3 bg-surface/80 pr-2 text-xs tabular-nums text-muted">
      <span>{candleTimeLabel(candle.time, interval)}</span>
      <span>O {candle.open.toFixed(2)}</span>
      <span>H {candle.high.toFixed(2)}</span>
      <span>L {candle.low.toFixed(2)}</span>
      <span>C {candle.close.toFixed(2)}</span>
      <span>Vol ${fmtCompact(candle.volume)}</span>
    </p>
  );
}

/// Index-price history from the indexer's samples (when `NEXT_PUBLIC_API_URL` is set and the
/// indexer has been running), followed by mark prices collected since this page opened, or
/// candlesticks with volume. Without the API it is a live session line only, and the panel title
/// says which one you are looking at.
export function PriceChart() {
  const symbol = useTerminal((state) => state.symbol);
  const { data, dataUpdatedAt } = usePerpMarket(symbol);
  const { data: positions } = usePositions();
  const { data: history } = usePriceHistory(symbol, "24h");
  const { data: decimals = 6 } = useSettlementDecimals();
  const [mode, setMode] = useState<Mode>("line");
  const [interval, setInterval] = useState<CandleInterval>("15m");
  const { data: rawCandles, isPending: loadingCandles } = useCandles(mode === "candles" ? symbol : "", interval);
  const [live, setLive] = useState<{ time: number; value: number }[]>([]);
  const [hoverTime, setHoverTime] = useState<number>();
  const [resetToken, setResetToken] = useState(0);
  const past = useMemo(() => (history ?? []).map((point) => ({ time: point.time, value: toNumber(point.price) })), [history]);
  const candles = useMemo(() => toCandlePoints(rawCandles ?? [], decimals), [rawCandles, decimals]);

  useEffect(() => setLive([]), [symbol]);
  useEffect(() => {
    if (!data) return;
    setLive((current) => [...current, { time: Math.floor(Date.now() / 1000), value: toNumber(data.markPrice) }].slice(-MAX_LIVE_POINTS));
    // A new sample arrives whenever the query refetches.
  }, [dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = useMemo<ChartLevel[]>(() => {
    if (!data) return [];
    const open = positions?.perps.filter((p) => p.open && symbolOf(p.marketId) === symbol) ?? [];
    return open.flatMap((position) => [
      { label: "Entry", price: toNumber(position.entryPrice), token: "--color-text" },
      {
        label: "Liquidation",
        price: toNumber(
          margin.liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, data.risk.maintenanceMarginRateBps),
        ),
        token: "--color-down",
      },
    ]);
  }, [data, positions, symbol]);

  const points = useMemo(() => mergeSeries(past, live), [past, live]);
  const showCandles = mode === "candles";
  const shown = candles.find((candle) => candle.time === hoverTime) ?? candles.at(-1);

  const title = `${symbol || "Market"}-PERP · ${
    showCandles ? `${interval} candles, volume in USD` : past.length > 1 ? "last 24 hours" : "mark price this session"
  }`;

  return (
    <Panel
      title={title}
      className="min-h-[300px] flex-1 lg:min-h-0"
      actions={
        <div className="flex flex-wrap items-center gap-2 py-1">
          {showCandles ? (
            <Segmented label="Candle interval" value={interval} onChange={setInterval} options={INTERVALS.map((value) => ({ value, label: value }))} className="w-44" />
          ) : null}
          <button type="button" onClick={() => setResetToken((value) => value + 1)} className={cn(chip, "h-7 rounded-md px-2.5 text-xs")}>
            Reset view
          </button>
          <Segmented
            label="Chart type"
            value={mode}
            onChange={setMode}
            options={[
              { value: "line", label: "Line" },
              { value: "candles", label: "Candles", disabled: !env.apiUrl },
            ]}
            className="w-36"
          />
        </div>
      }
    >
      <div className="min-h-0 flex-1 p-3">
        {showCandles ? (
          loadingCandles ? (
            <p className="text-muted">Loading candles…</p>
          ) : candles.length < 2 ? (
            <p className="text-muted">Not enough price samples for {interval} candles yet. The indexer samples the index price once a minute.</p>
          ) : (
            <div className="relative h-full min-h-[240px] w-full">
              <TradingChart key={`candles-${symbol}-${interval}`} data={{ mode: "candles", candles }} levels={levels} onHover={setHoverTime} resetToken={resetToken} />
              {shown ? <CandleReadout candle={shown} interval={interval} /> : null}
            </div>
          )
        ) : points.length < 2 ? (
          <p className="text-muted">Collecting prices… the line builds as they arrive.</p>
        ) : (
          <div className="relative h-full min-h-[240px] w-full">
            <TradingChart key={`line-${symbol}`} data={{ mode: "line", points }} levels={levels} resetToken={resetToken} />
          </div>
        )}
      </div>
    </Panel>
  );
}
