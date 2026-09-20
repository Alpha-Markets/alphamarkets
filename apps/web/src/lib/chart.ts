import { formatUnits } from "viem";
import type { Candle } from "@orionis/sdk";
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

export interface Scale {
  lo: number;
  hi: number;
  /// Pixel row for a price: `hi` maps to 0 and `lo` to `height`.
  y: (value: number) => number;
}

/// A vertical scale that fits the candles and any extra levels (entry, liquidation), with padding
/// so the extremes do not sit on the edge. A flat series gets a small artificial range rather than
/// a divide by zero.
export function priceScale(candles: CandlePoint[], levels: number[], height: number): Scale {
  const values = [...candles.flatMap((c) => [c.high, c.low]), ...levels];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min || max * 0.002 || 1) * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  return { lo, hi, y: (value) => height - ((value - lo) / (hi - lo)) * height };
}

export interface Layout {
  /// Width of one candle slot.
  slot: number;
  /// Width of the drawn body, leaving a gap between neighbours.
  body: number;
  /// Horizontal centre of candle `index`.
  x: (index: number) => number;
  /// Which candle a horizontal position falls in, clamped to the drawn range.
  indexAt: (position: number) => number;
}

/// Lays `count` candles across `width`, newest at the right edge. Fewer than `capacity` candles
/// use the right-hand part, so a young chart grows leftwards instead of stretching.
export function candleLayout(count: number, width: number, capacity: number): Layout {
  const slot = width / Math.max(capacity, 1);
  const offset = width - count * slot;
  return {
    slot,
    body: Math.max(slot * 0.62, 1),
    x: (index) => offset + (index + 0.5) * slot,
    indexAt: (position) => Math.min(Math.max(Math.floor((position - offset) / slot), 0), Math.max(count - 1, 0)),
  };
}

/// Height in pixels of a volume bar, out of `maxHeight` for the busiest bucket.
export function volumeBar(volume: number, maxVolume: number, maxHeight: number): number {
  if (maxVolume <= 0 || volume <= 0) return 0;
  return Math.max((volume / maxVolume) * maxHeight, 1);
}

/// "14:30" for intraday intervals and "Sep 19" for daily ones.
export function candleTimeLabel(time: number, interval: string): string {
  const date = new Date(time * 1000);
  if (interval === "1d") return date.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
}
