import { CANDLE_INTERVALS, type Candle, type CandleInterval } from "./analytics.js";

/// Past candles for the chart, from Yahoo Finance's public chart endpoint. The indexer only holds
/// index-price samples from the day it started, and the oracle price barely moves while the market
/// is closed, so the chart is short and flat. The underlying stock's own history fills in the time
/// before the indexer began. Display only: nothing that decides money reads it, and the indexed
/// candles always win where the two overlap.

const YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const REQUEST_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60_000;
/// Prices are 18-decimal fixed point in the API. Yahoo quotes need at most 8 decimals.
const PRICE_SCALE = 10n ** 10n;

/// The widest range Yahoo serves for each interval.
const YAHOO_INTERVALS: Record<CandleInterval, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "7d" },
  "5m": { interval: "5m", range: "60d" },
  "15m": { interval: "15m", range: "60d" },
  "1h": { interval: "60m", range: "730d" },
  "1d": { interval: "1d", range: "5y" },
};

export interface Bar {
  /// Unix seconds.
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function toPrice(value: number): string {
  return (BigInt(Math.round(value * 1e8)) * PRICE_SCALE).toString();
}

/// Regroups bars into buckets on the same grid the indexed candles use (multiples of the bucket
/// length since the Unix epoch), so a Yahoo bar that starts at 13:30 lands in the right bucket.
/// Volume is 0: it is perp notional traded on AlphaMarkets, and there is none for past bars.
export function bucketBars(bars: Bar[], bucketSeconds: number): Candle[] {
  const buckets = new Map<number, Bar[]>();
  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    const time = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    const group = buckets.get(time);
    if (group) group.push(bar);
    else buckets.set(time, [bar]);
  }
  return [...buckets.entries()].map(([time, group]) => ({
    time,
    open: toPrice(group[0]!.open),
    high: toPrice(Math.max(...group.map((bar) => bar.high))),
    low: toPrice(Math.min(...group.map((bar) => bar.low))),
    close: toPrice(group[group.length - 1]!.close),
    volume: "0",
  }));
}

/// Past candles first, then the indexed ones, keeping the newest `limit`. A past candle is dropped
/// once the indexer has any candle at or after its time.
export function mergeHistory(past: Candle[], indexed: Candle[], limit: number): Candle[] {
  const firstIndexed = indexed[0]?.time ?? Infinity;
  return [...past.filter((candle) => candle.time < firstIndexed), ...indexed].slice(-limit);
}

export interface PricePoint {
  time: number;
  price: string;
}

/// Line-chart points from past candles: each candle's close, kept when it falls in
/// `[fromSeconds, beforeSeconds)` and thinned to the last one per bucket like the indexed history.
export function pastPricePoints(past: Candle[], fromSeconds: number, beforeSeconds: number, bucketSeconds: number): PricePoint[] {
  const byBucket = new Map<number, PricePoint>();
  for (const candle of past) {
    if (candle.time < fromSeconds || candle.time >= beforeSeconds) continue;
    const time = Math.floor(candle.time / bucketSeconds) * bucketSeconds;
    if (time >= beforeSeconds) continue;
    byBucket.set(time, { time, price: candle.close });
  }
  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }[] };
    }[];
  };
}

/// Bars from a Yahoo chart response. Yahoo returns null for a bar with no trades; those are skipped.
export function parseYahooBars(body: YahooChart): Bar[] {
  const result = body.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !quote) return [];
  const bars: Bar[] = [];
  result.timestamp.forEach((time, index) => {
    const open = quote.open?.[index];
    const high = quote.high?.[index];
    const low = quote.low?.[index];
    const close = quote.close?.[index];
    if (open == null || high == null || low == null || close == null) return;
    bars.push({ time, open, high, low, close });
  });
  return bars;
}

const cache = new Map<string, { at: number; candles: Candle[] }>();

/// Past candles for `symbol` at `interval`, or an empty list when the source is off or unreachable:
/// the chart then shows only what the indexer recorded.
export async function fetchPastCandles(symbol: string, interval: CandleInterval): Promise<Candle[]> {
  if (process.env.EXTERNAL_CANDLE_HISTORY === "false") return [];
  const key = `${symbol}:${interval}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.candles;

  const { interval: yahooInterval, range } = YAHOO_INTERVALS[interval];
  try {
    const response = await fetch(`${YAHOO_URL}/${encodeURIComponent(symbol)}?interval=${yahooInterval}&range=${range}`, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const candles = bucketBars(parseYahooBars((await response.json()) as YahooChart), CANDLE_INTERVALS[interval]);
    cache.set(key, { at: Date.now(), candles });
    return candles;
  } catch (error) {
    console.warn(`api: could not load past ${interval} candles for ${symbol}`, error);
    // Serve a stale copy rather than nothing, and do not retry on every request.
    const candles = hit?.candles ?? [];
    cache.set(key, { at: Date.now() - CACHE_TTL_MS + 30_000, candles });
    return candles;
  }
}
