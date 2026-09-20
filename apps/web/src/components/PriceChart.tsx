"use client";

import { Panel, Segmented } from "@orionis/ui";
import type { CandleInterval } from "@orionis/sdk";
import { formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
import { useCandles, usePerpMarket, usePositions, usePriceHistory, useSettlementDecimals } from "@/hooks/queries";
import { candleLayout, candleTimeLabel, priceScale, toCandlePoints, volumeBar, type CandlePoint } from "@/lib/chart";
import { env } from "@/lib/env";
import { PRICE_DECIMALS } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { margin } from "@orionis/sdk";

const MAX_POINTS = 300;
const W = 1000;
const H = 320;
/// The lowest part of the plot is kept for volume bars.
const VOLUME_HEIGHT = 56;
const PRICE_HEIGHT = H - VOLUME_HEIGHT - 8;
/// Candles the API returns at most (`useCandles` asks for this many), and the fewest slots the chart
/// spreads them over: a young chart grows leftwards from the newest candle instead of filling the
/// width with a handful of fat candles.
const CANDLE_CAPACITY = 120;
const MIN_CANDLE_SLOTS = 40;

type Mode = "line" | "candles";
const INTERVALS: CandleInterval[] = ["5m", "15m", "1h", "1d"];

const toNumber = (value: bigint) => Number(formatUnits(value, PRICE_DECIMALS));

interface Level {
  label: string;
  price: number;
  tone: string;
}

/// Labels for the reference lines, HTML positioned over the SVG so the stretched viewBox does not
/// distort the text.
function LevelLabels({ levels, y, height }: { levels: Level[]; y: (price: number) => number; height: number }) {
  return (
    <>
      {levels.map((level) => (
        <span
          key={level.label}
          className={`pointer-events-none absolute left-0 -translate-y-full text-xs ${level.tone}`}
          style={{ top: `${(y(level.price) / height) * 100}%` }}
        >
          {level.label} {level.price.toFixed(2)}
        </span>
      ))}
    </>
  );
}

function LineView({ points, levels }: { points: number[]; levels: Level[] }) {
  const all = [...points, ...levels.map((level) => level.price)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || max * 0.002 || 1) * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const y = (price: number) => H - ((price - lo) / (hi - lo)) * H;
  const x = (index: number) => (points.length < 2 ? 0 : (index / (MAX_POINTS - 1)) * W + (W - ((points.length - 1) / (MAX_POINTS - 1)) * W));

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Price over time">
        {levels.map((level) => (
          <line key={level.label} x1={0} x2={W} y1={y(level.price)} y2={y(level.price)} stroke="currentColor" strokeDasharray="4 6" className={level.tone} vectorEffect="non-scaling-stroke" />
        ))}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="text-text"
          points={points.map((price, index) => `${x(index)},${y(price)}`).join(" ")}
        />
      </svg>
      <span className="pointer-events-none absolute right-0 top-0 text-xs tabular-nums text-muted">{hi.toFixed(2)}</span>
      <span className="pointer-events-none absolute bottom-0 right-0 text-xs tabular-nums text-muted">{lo.toFixed(2)}</span>
      <LevelLabels levels={levels} y={y} height={H} />
    </div>
  );
}

const fmtCompact = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

/// Candlesticks from the indexer's price samples, with the perp notional traded in each bucket as
/// volume bars underneath. Hovering a candle reads out its open, high, low, close and volume.
function CandleView({ candles, levels, interval }: { candles: CandlePoint[]; levels: Level[]; interval: CandleInterval }) {
  const [hover, setHover] = useState<number>();
  const scale = priceScale(candles, levels.map((level) => level.price), PRICE_HEIGHT);
  const layout = candleLayout(candles.length, W, Math.min(Math.max(candles.length, MIN_CANDLE_SLOTS), CANDLE_CAPACITY));
  const maxVolume = Math.max(...candles.map((candle) => candle.volume), 0);
  const shown = hover === undefined ? candles.at(-1) : candles[hover];

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`Candlestick chart, ${interval} candles`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(layout.indexAt(((event.clientX - box.left) / box.width) * W));
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        {levels.map((level) => (
          <line key={level.label} x1={0} x2={W} y1={scale.y(level.price)} y2={scale.y(level.price)} stroke="currentColor" strokeDasharray="4 6" className={level.tone} vectorEffect="non-scaling-stroke" />
        ))}
        {candles.map((candle, index) => {
          const rising = candle.close >= candle.open;
          const tone = rising ? "text-up" : "text-down";
          const cx = layout.x(index);
          const top = scale.y(Math.max(candle.open, candle.close));
          const bottom = scale.y(Math.min(candle.open, candle.close));
          const bar = volumeBar(candle.volume, maxVolume, VOLUME_HEIGHT);
          return (
            <g key={candle.time} className={tone} opacity={hover === undefined || hover === index ? 1 : 0.55}>
              <line x1={cx} x2={cx} y1={scale.y(candle.high)} y2={scale.y(candle.low)} stroke="currentColor" vectorEffect="non-scaling-stroke" />
              <rect x={cx - layout.body / 2} y={top} width={layout.body} height={Math.max(bottom - top, 1)} fill="currentColor" />
              {bar > 0 ? <rect x={cx - layout.body / 2} y={H - bar} width={layout.body} height={bar} fill="currentColor" opacity={0.45} /> : null}
            </g>
          );
        })}
      </svg>
      <span className="pointer-events-none absolute right-0 top-0 text-xs tabular-nums text-muted">{scale.hi.toFixed(2)}</span>
      <span className="pointer-events-none absolute right-0 text-xs tabular-nums text-muted" style={{ top: `${(PRICE_HEIGHT / H) * 100}%`, transform: "translateY(-100%)" }}>
        {scale.lo.toFixed(2)}
      </span>
      <LevelLabels levels={levels} y={scale.y} height={H} />
      {shown ? (
        <p className="pointer-events-none absolute left-0 top-0 flex flex-wrap gap-x-3 bg-surface/80 pr-2 text-xs tabular-nums text-muted">
          <span>{candleTimeLabel(shown.time, interval)}</span>
          <span>O {shown.open.toFixed(2)}</span>
          <span>H {shown.high.toFixed(2)}</span>
          <span>L {shown.low.toFixed(2)}</span>
          <span>C {shown.close.toFixed(2)}</span>
          <span>Vol ${fmtCompact(shown.volume)}</span>
        </p>
      ) : null}
    </div>
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
  const [live, setLive] = useState<number[]>([]);
  const past = useMemo(() => (history ?? []).map((point) => toNumber(point.price)), [history]);
  const candles = useMemo(() => toCandlePoints(rawCandles ?? [], decimals), [rawCandles, decimals]);

  useEffect(() => setLive([]), [symbol]);
  useEffect(() => {
    if (!data) return;
    setLive((current) => [...current, toNumber(data.markPrice)].slice(-MAX_POINTS));
    // A new sample arrives whenever the query refetches.
  }, [dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const levels = useMemo<Level[]>(() => {
    if (!data) return [];
    const open = positions?.perps.filter((p) => p.open && symbolOf(p.marketId) === symbol) ?? [];
    return open.flatMap((position) => [
      { label: "Entry", price: toNumber(position.entryPrice), tone: "text-text" },
      {
        label: "Liquidation",
        price: toNumber(
          margin.liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, data.risk.maintenanceMarginRateBps),
        ),
        tone: "text-down",
      },
    ]);
  }, [data, positions, symbol]);

  const points = useMemo(() => [...past, ...live].slice(-MAX_POINTS), [past, live]);
  const showCandles = mode === "candles";

  const title = `${symbol || "Market"}-PERP · ${
    showCandles ? `${interval} candles, volume in USD` : past.length > 1 ? "last 24 hours" : "mark price this session"
  }`;

  return (
    <Panel
      title={title}
      className="min-h-0 flex-1"
      actions={
        <div className="flex items-center gap-2">
          {showCandles ? (
            <Segmented label="Candle interval" value={interval} onChange={setInterval} options={INTERVALS.map((value) => ({ value, label: value }))} className="w-40" />
          ) : null}
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
            <CandleView candles={candles} levels={levels} interval={interval} />
          )
        ) : points.length < 2 ? (
          <p className="text-muted">Collecting prices… the line builds as they arrive.</p>
        ) : (
          <LineView points={points} levels={levels} />
        )}
      </div>
    </Panel>
  );
}
