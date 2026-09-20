/// Volatility surface (PROJECT_BRIEF.md Sections 39 and 42, "volatility surface" and "volatility
/// skew"): the volatility this service prices each strike and expiry with.
///
/// It is the pricing MODEL's surface, not a market-implied one: options here are bought from and
/// sold back to the pool, so there is no order book to imply anything from. The level is the
/// realized volatility of the underlying (or the flat default, see `volatility.ts`), and the shape
/// around it comes from three configured parameters. With all three at 0 (the default) the surface
/// is flat and every strike and expiry prices with the same volatility. Setting them is a product
/// decision, like the fee schedule; the response says where the level came from.
import { advancedGreeks, type AdvancedGreeks } from "./greeks.js";
import { quote, type OptionType, type QuoteResult } from "./blackScholes.js";
import { YEAR_SECONDS, type VolatilitySource } from "./volatility.js";

export interface SurfaceShape {
  /// Change in volatility per unit of log-moneyness ln(K / S). Negative gives a put skew: lower
  /// strikes are priced with more volatility.
  skewSlope: number;
  /// Extra volatility per unit of squared log-moneyness: the smile's curvature.
  smileCurve: number;
  /// Change in volatility per unit of sqrt(T) away from the anchor expiry.
  termSlope: number;
}

export const FLAT_SURFACE: SurfaceShape = { skewSlope: 0, smileCurve: 0, termSlope: 0 };

/// Expiry the term structure is anchored on: the base volatility applies at-the-money here.
const ANCHOR_YEARS = 30 / 365;

export interface SurfaceBounds {
  min: number;
  max: number;
}

/// Volatility for one strike and expiry, clamped to the bounds used for the base volatility.
export function surfaceVolatility(
  base: number,
  shape: SurfaceShape,
  bounds: SurfaceBounds,
  spot: number,
  strike: number,
  timeToExpiryYears: number,
): number {
  const moneyness = Math.log(strike / spot);
  const raw =
    base +
    shape.skewSlope * moneyness +
    shape.smileCurve * moneyness * moneyness +
    shape.termSlope * (Math.sqrt(timeToExpiryYears) - Math.sqrt(ANCHOR_YEARS));
  return Math.min(Math.max(raw, bounds.min), bounds.max);
}

export interface SurfaceSideQuote extends Pick<QuoteResult, "premium" | "delta" | "gamma" | "theta" | "vega"> {
  greeks: AdvancedGreeks;
}

export interface SurfacePoint {
  strike: number;
  iv: number;
  call: SurfaceSideQuote;
  put: SurfaceSideQuote;
}

export interface SurfaceExpiry {
  /// Unix seconds.
  expiry: number;
  timeToExpiryYears: number;
  /// Volatility at the strike closest to spot.
  atmIv: number;
  /// Volatility 10% below spot less volatility 10% above it: positive means puts cost more.
  skew: number;
  points: SurfacePoint[];
}

export interface Surface {
  spot: number;
  /// Where the base volatility came from; not market-implied either way.
  ivSource: VolatilitySource;
  baseVolatility: number;
  shape: SurfaceShape;
  strikes: number[];
  expiries: SurfaceExpiry[];
}

export interface SurfaceRequest {
  spot: number;
  strikes: number[];
  /// Unix seconds; any that is not in the future is skipped.
  expiries: number[];
  nowSeconds: number;
  baseVolatility: number;
  ivSource: VolatilitySource;
  shape: SurfaceShape;
  bounds: SurfaceBounds;
  riskFreeRate: number;
}

function sideQuote(spot: number, strike: number, T: number, iv: number, r: number, type: OptionType): SurfaceSideQuote {
  const input = { spot, strike, timeToExpiryYears: T, volatility: iv, riskFreeRate: r, optionType: type };
  const { premium, delta, gamma, theta, vega } = quote(input);
  return { premium, delta, gamma, theta, vega, greeks: advancedGreeks(input) };
}

export function buildSurface(request: SurfaceRequest): Surface {
  const { spot, nowSeconds, baseVolatility, shape, bounds, riskFreeRate } = request;
  const strikes = [...new Set(request.strikes)].sort((a, b) => a - b);
  const expiries: SurfaceExpiry[] = [];

  for (const expiry of [...new Set(request.expiries)].sort((a, b) => a - b)) {
    const T = (expiry - nowSeconds) / YEAR_SECONDS;
    if (!(T > 0)) continue;

    const ivAt = (strike: number) => surfaceVolatility(baseVolatility, shape, bounds, spot, strike, T);
    const points = strikes.map((strike) => {
      const iv = ivAt(strike);
      return { strike, iv, call: sideQuote(spot, strike, T, iv, riskFreeRate, "CALL"), put: sideQuote(spot, strike, T, iv, riskFreeRate, "PUT") };
    });
    expiries.push({ expiry, timeToExpiryYears: T, atmIv: ivAt(spot), skew: ivAt(spot * 0.9) - ivAt(spot * 1.1), points });
  }

  return { spot, ivSource: request.ivSource, baseVolatility, shape, strikes, expiries };
}
