/// Volatility input for the option model. There is no options order book to imply a volatility
/// from (the protocol is the only counterparty and quotes from this model), so a market-implied
/// figure would only echo back whatever this service assumed. What the data can support is the
/// underlying's realized volatility, measured from the indexed index-price history. When there is
/// not enough usable history the caller falls back to a flat assumption, and says so.

export const YEAR_SECONDS = 365 * 24 * 60 * 60;

export interface PriceSample {
  /// Unix seconds.
  time: number;
  price: number;
}

export interface VolatilityBounds {
  /// Fewest samples worth trusting.
  minSamples: number;
  /// Floor and ceiling for the annualized figure, as fractions (0.1 = 10%).
  min: number;
  max: number;
}

export type VolatilitySource = "realized" | "default";

export interface Volatility {
  value: number;
  source: VolatilitySource;
}

/// Annualized realized volatility from log returns, weighting each return by the time it spans so
/// gaps in the samples do not inflate it: `sqrt(sum(r^2) / sum(dt) * year)`. Returns `undefined`
/// when there are too few samples, or the price never moved (a flat feed has no volatility to
/// measure, and zero would make the model reject the quote).
export function realizedVolatility(samples: PriceSample[], minSamples: number): number | undefined {
  const ordered = samples
    .filter((sample) => Number.isFinite(sample.price) && sample.price > 0)
    .sort((a, b) => a.time - b.time);
  if (ordered.length < Math.max(minSamples, 2)) return undefined;

  let sumSquares = 0;
  let sumSeconds = 0;
  for (let i = 1; i < ordered.length; i++) {
    const seconds = ordered[i]!.time - ordered[i - 1]!.time;
    if (seconds <= 0) continue;
    const logReturn = Math.log(ordered[i]!.price / ordered[i - 1]!.price);
    sumSquares += logReturn * logReturn;
    sumSeconds += seconds;
  }
  if (sumSeconds === 0 || sumSquares === 0) return undefined;
  return Math.sqrt((sumSquares / sumSeconds) * YEAR_SECONDS);
}

/// The volatility to price with: the realized figure clamped to the bounds, or `fallback` when
/// none could be measured.
export function chooseVolatility(samples: PriceSample[], fallback: number, bounds: VolatilityBounds): Volatility {
  const realized = realizedVolatility(samples, bounds.minSamples);
  if (realized === undefined) return { value: fallback, source: "default" };
  return { value: Math.min(Math.max(realized, bounds.min), bounds.max), source: "realized" };
}
