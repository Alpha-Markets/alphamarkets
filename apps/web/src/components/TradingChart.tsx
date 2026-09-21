"use client";

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { CandlePoint, SeriesPoint } from "@/lib/chart";

/// A reference line on the chart. `token` names the CSS colour it is drawn in (`--color-down`), so the
/// chart follows the theme and no colour is written twice.
export interface ChartLevel {
  label: string;
  price: number;
  token: string;
}

export type ChartData = { mode: "line"; points: SeriesPoint[] } | { mode: "candles"; candles: CandlePoint[] };

interface TradingChartProps {
  data: ChartData;
  levels: ChartLevel[];
  /// The candle time under the cursor, or undefined when the cursor leaves the chart.
  onHover?: (time: number | undefined) => void;
  /// Changing this value returns the view to its starting range.
  resetToken: number;
}

/// Candles in view when a candle chart opens; the rest is a zoom-out or a drag away.
const INITIAL_CANDLES = 120;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fade = (color: string, alpha: number) =>
  /^#[0-9a-f]{6}$/i.test(color) ? `${color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : color;
const utc = (time: number) => time as UTCTimestamp;
const priceFormat = { type: "price", precision: 2, minMove: 0.01 } as const;

/// The chart TradingView's own library draws, fed with AlphaMarkets prices. Dragging pans, the wheel
/// or a pinch zooms, and a double click on an axis resets it. This component keeps that view: a
/// refetch sends only the rows from the last one drawn, so it never moves what the user is looking at.
/// Mount it with a `key` that changes with the market and the interval, so each starts at its own range.
export function TradingChart({ data, levels, onHover, resetToken }: TradingChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Line"> | ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const drawn = useRef<number | undefined>(undefined);
  const count = useRef(0);
  const hover = useRef(onHover);
  hover.current = onHover;
  const mode = data.mode;

  const initialView = () => {
    const timeScale = chartRef.current?.timeScale();
    if (!timeScale) return;
    if (mode === "candles" && count.current > INITIAL_CANDLES) timeScale.setVisibleLogicalRange({ from: count.current - INITIAL_CANDLES, to: count.current + 3 });
    else timeScale.fitContent();
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const line = css("--color-line");
    const up = css("--color-up");
    const down = css("--color-down");
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--color-muted"),
        fontFamily: getComputedStyle(el).fontFamily,
        fontSize: 12,
        // TradingView's licence asks for a link back to them; the logo is that link.
        attributionLogo: true,
      },
      grid: { vertLines: { color: fade(line, 0.5) }, horzLines: { color: fade(line, 0.5) } },
      rightPriceScale: { borderColor: line },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      // Dragging up or down on a phone scrolls the page; only a sideways drag pans the chart.
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;

    if (mode === "candles") {
      const main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, priceFormat });
      main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
      const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
      volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      mainRef.current = main;
      volumeRef.current = volume;
    } else {
      mainRef.current = chart.addSeries(LineSeries, { color: css("--color-accent"), lineWidth: 2, priceFormat });
    }

    const onMove = (param: { time?: unknown }) => hover.current?.(typeof param.time === "number" ? param.time : undefined);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      volumeRef.current = null;
      drawn.current = undefined;
    };
  }, [mode]);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const first = drawn.current === undefined;
    const since = drawn.current ?? -Infinity;
    if (data.mode === "line") {
      const rows = data.points.map((point) => ({ time: utc(point.time), value: point.value }));
      if (rows.length === 0) return;
      const series = main as ISeriesApi<"Line">;
      if (first) series.setData(rows);
      else for (const row of rows) if (row.time >= since) series.update(row);
      drawn.current = rows[rows.length - 1]!.time;
      count.current = rows.length;
    } else {
      const rows = data.candles.map((candle) => ({ time: utc(candle.time), open: candle.open, high: candle.high, low: candle.low, close: candle.close }));
      if (rows.length === 0) return;
      const up = fade(css("--color-up"), 0.45);
      const down = fade(css("--color-down"), 0.45);
      const bars = data.candles.map((candle) => ({ time: utc(candle.time), value: candle.volume, color: candle.close >= candle.open ? up : down }));
      const series = main as ISeriesApi<"Candlestick">;
      if (first) {
        series.setData(rows);
        volumeRef.current?.setData(bars);
      } else {
        rows.forEach((row) => row.time >= since && series.update(row));
        bars.forEach((bar) => bar.time >= since && volumeRef.current?.update(bar));
      }
      drawn.current = rows[rows.length - 1]!.time;
      count.current = rows.length;
    }
    if (first) initialView();
    // `initialView` only reads refs and the mode.
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const main = mainRef.current;
    const chart = chartRef.current;
    if (!main || !chart) return;
    const lines: IPriceLine[] = levels.map((level) =>
      main.createPriceLine({ price: level.price, color: css(level.token), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: level.label }),
    );
    return () => {
      // On unmount the chart above has already been removed and its lines went with it.
      if (chartRef.current === chart) lines.forEach((line) => main.removePriceLine(line));
    };
  }, [levels, mode]);

  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    initialView();
    // `initialView` only reads refs and the mode.
  }, [resetToken]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="absolute inset-0" />;
}
