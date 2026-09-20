import { formatUnits } from "viem";
import type { FundingRatePoint, OpenInterestPoint } from "@orionis/sdk";

/// Share of open interest on the long side, in whole percent, or `undefined` when there is none.
/// 50 means balanced; above it, longs outweigh shorts.
export function longSharePercent(long: bigint, short: bigint): number | undefined {
  const total = long + short;
  if (total === 0n) return undefined;
  return Number((long * 100n) / total);
}

/// How much of the open-interest cap is used, in basis points (10000 = full), or `undefined` when
/// no cap is set.
export function utilizationBps(total: bigint, cap: bigint): number | undefined {
  if (cap === 0n) return undefined;
  return Number((total * 10_000n) / cap);
}

export interface OiChartPoint {
  time: number;
  long: number;
  short: number;
}

/// Open-interest history as plain numbers in settlement-token units, ready to draw.
export function toOiChartPoints(points: OpenInterestPoint[], tokenDecimals: number): OiChartPoint[] {
  const units = (value: bigint) => Number(formatUnits(value, tokenDecimals));
  return points.map((point) => ({ time: point.time, long: units(point.long), short: units(point.short) }));
}

export interface FundingBar {
  time: number;
  /// Percent per interval: 0.05 means longs paid shorts 0.05%.
  percent: number;
}

/// Funding rates as percentages per interval. The chain stores basis points, so 5 becomes 0.05.
export function toFundingBars(points: FundingRatePoint[]): FundingBar[] {
  return points.map((point) => ({ time: point.time, percent: Number(point.rateBps) / 100 }));
}

/// Mean funding rate over the given bars, in percent per interval, or `undefined` for none.
export function averageFunding(bars: FundingBar[]): number | undefined {
  if (bars.length === 0) return undefined;
  return bars.reduce((sum, bar) => sum + bar.percent, 0) / bars.length;
}

/// True when every recorded rate is exactly zero: the chain applied funding but nothing moved, as
/// happens while there is no mark price separate from the index price.
export const allFundingZero = (bars: FundingBar[]) => bars.length > 0 && bars.every((bar) => bar.percent === 0);
