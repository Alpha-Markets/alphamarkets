/// Pure helpers for `routes/stats.ts`, kept free of I/O so they can be unit tested.

export const RANGES = {
  "1h": { rangeSeconds: 3_600, bucketSeconds: 30 },
  "6h": { rangeSeconds: 21_600, bucketSeconds: 120 },
  "24h": { rangeSeconds: 86_400, bucketSeconds: 300 },
  "7d": { rangeSeconds: 604_800, bucketSeconds: 1_800 },
} as const;

export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | undefined): RangeKey {
  return value !== undefined && value in RANGES ? (value as RangeKey) : "24h";
}

/// Percentage change in basis points between two 18-decimal price strings, rounded toward zero.
/// Null when there is no usable baseline (no samples yet, or a zero price).
export function changeBps(latest: string | null | undefined, base: string | null | undefined): number | null {
  if (!latest || !base) return null;
  const baseValue = BigInt(base);
  if (baseValue === 0n) return null;
  return Number(((BigInt(latest) - baseValue) * 10_000n) / baseValue);
}
