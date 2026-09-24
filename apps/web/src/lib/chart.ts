import { formatUnits } from "viem";
import type { Candle } from "@alphamarkets/sdk";
import { PRICE_DECIMALS } from "./format";

/// A candle as the chart draws it: plain numbers, since drawing needs no more precision than a
/// pixel. The figures stay `bigint` until this last step.
export interface CandlePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /// Perp notional traded, in settlement-token units (not base units).
  volume: number;
}

export function toCandlePoints(candles: Candle[], tokenDecimals: number): CandlePoint[] {
  const price = (value: bigint) => Number(formatUnits(value, PRICE_DECIMALS));
  return candles.map((candle) => ({
    time: candle.time,
    open: price(candle.open),
    high: price(candle.high),
    low: price(candle.low),
    close: price(candle.close),
    volume: Number(formatUnits(candle.volume, tokenDecimals)),
  }));
}

/// One point of a line series: unix seconds and a price.
export interface SeriesPoint {
  time: number;
  value: number;
}

/// Joins stored history with the samples collected since the page opened. A chart needs strictly
/// ascending times, so the rows are sorted and a later row replaces an earlier one at the same second.
export function mergeSeries(...parts: SeriesPoint[][]): SeriesPoint[] {
  const merged: SeriesPoint[] = [];
  for (const point of parts.flat().sort((a, b) => a.time - b.time)) {
    if (merged.length > 0 && merged[merged.length - 1]!.time === point.time) merged[merged.length - 1] = point;
    else merged.push(point);
  }
  return merged;
}

/// "14:30" for intraday intervals and "Sep 19" for daily ones.
export function candleTimeLabel(time: number, interval: string): string {
  const date = new Date(time * 1000);
  if (interval === "1d") return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}
