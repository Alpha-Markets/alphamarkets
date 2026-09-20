/// Pure helpers for `routes/analytics.ts`, kept free of I/O so they can be unit tested.

export const CANDLE_INTERVALS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3_600,
  "1d": 86_400,
} as const;

export type CandleInterval = keyof typeof CANDLE_INTERVALS;

export const DEFAULT_CANDLE_LIMIT = 120;
export const MAX_CANDLE_LIMIT = 500;

export function parseInterval(value: string | undefined): CandleInterval {
  return value !== undefined && value in CANDLE_INTERVALS ? (value as CandleInterval) : "5m";
}

export function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export interface OhlcRow {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface VolumeRow {
  time: number;
  volume: string;
}

export interface Candle extends OhlcRow {
  /// Perp notional traded in the bucket, settlement-token base units.
  volume: string;
}

/// Joins price buckets to the perp volume traded in the same bucket. A bucket with a price but no
/// trades has volume 0; trades in a bucket with no price sample are dropped, since a candle needs
/// a price.
export function mergeCandles(prices: OhlcRow[], volumes: VolumeRow[]): Candle[] {
  const byTime = new Map(volumes.map((row) => [row.time, row.volume]));
  return prices.map((row) => ({ ...row, volume: byTime.get(row.time) ?? "0" }));
}

/// One change in a perp position's size, from the indexed events. `delta` is signed notional:
/// positive when the position grew or opened, negative when it shrank, closed or was liquidated.
export interface SizeDelta {
  /// Unix seconds.
  time: number;
  isLong: boolean;
  delta: bigint;
}

export interface OpenInterestPoint {
  /// Unix seconds, the start of the bucket.
  time: number;
  long: string;
  short: string;
}

/// Open interest over time as running long and short totals, sampled at the end of each bucket.
/// `deltas` must be in event order and cover the market's whole history: the running totals are
/// only right if they start from zero. Only buckets inside `[fromSeconds, toSeconds]` are
/// returned, and the last one carries the current totals. A bucket with no events repeats the
/// previous totals so the line is continuous.
export function openInterestSeries(
  deltas: SizeDelta[],
  bucketSeconds: number,
  fromSeconds: number,
  toSeconds: number,
): OpenInterestPoint[] {
  const bucketOf = (time: number) => Math.floor(time / bucketSeconds) * bucketSeconds;
  let long = 0n;
  let short = 0n;
  let cursor = 0;

  // Totals before the window starts.
  while (cursor < deltas.length && deltas[cursor]!.time < bucketOf(fromSeconds)) {
    const change = deltas[cursor]!;
    if (change.isLong) long += change.delta;
    else short += change.delta;
    cursor++;
  }

  const points: OpenInterestPoint[] = [];
  for (let bucket = bucketOf(fromSeconds); bucket <= toSeconds; bucket += bucketSeconds) {
    while (cursor < deltas.length && deltas[cursor]!.time < bucket + bucketSeconds) {
      const change = deltas[cursor]!;
      if (change.isLong) long += change.delta;
      else short += change.delta;
      cursor++;
    }
    points.push({ time: bucket, long: long.toString(), short: short.toString() });
  }
  return points;
}

/// Range key to window and bucket size for the open-interest chart.
export const OI_RANGES = {
  "24h": { rangeSeconds: 86_400, bucketSeconds: 900 },
  "7d": { rangeSeconds: 604_800, bucketSeconds: 7_200 },
  "30d": { rangeSeconds: 2_592_000, bucketSeconds: 43_200 },
} as const;

export type OiRange = keyof typeof OI_RANGES;

export function parseOiRange(value: string | undefined): OiRange {
  return value !== undefined && value in OI_RANGES ? (value as OiRange) : "7d";
}
