/// Higher-order option Greeks (PROJECT_BRIEF.md Section 39, "advanced options Greeks") for the
/// same Black-Scholes model `blackScholes.ts` prices with. Display analytics only: they describe
/// how the model's own price moves, and never feed a signed quote, settlement or margin.
///
/// All figures are per unit of the underlying, in the model's natural units (a year for time, an
/// absolute 1.00 for volatility and rate). The API's readers rescale for display: per day divide
/// by 365, per volatility point divide by 100.
import type { OptionType } from "./blackScholes.js";

export interface AdvancedGreeksInput {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  volatility: number;
  riskFreeRate: number;
  optionType: OptionType;
}

export interface AdvancedGreeks {
  /// Change in price per 1.00 change in the risk-free rate.
  rho: number;
  /// Change in delta per 1.00 change in volatility (equally, change in vega per unit of spot).
  vanna: number;
  /// Change in vega per 1.00 change in volatility (also called volga).
  vomma: number;
  /// Change in delta as time passes, per year (delta decay).
  charm: number;
  /// Change in gamma per unit of spot.
  speed: number;
  /// Change in gamma as time passes, per year (gamma decay).
  color: number;
}

const normPdf = (x: number) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}
const normCdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

export function advancedGreeks(input: AdvancedGreeksInput): AdvancedGreeks {
  const { spot: S, strike: K, timeToExpiryYears: T, volatility: sigma, riskFreeRate: r, optionType } = input;
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    throw new Error("advancedGreeks: spot, strike, volatility, and time to expiry must all be positive");
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const discountedK = K * Math.exp(-r * T);

  const rho = optionType === "CALL" ? T * discountedK * normCdf(d2) : -T * discountedK * normCdf(-d2);
  const vega = S * pdf * sqrtT;
  const gamma = pdf / (S * sigma * sqrtT);

  const vanna = (-pdf * d2) / sigma;
  const vomma = (vega * d1 * d2) / sigma;
  const speed = (-gamma / S) * (d1 / (sigma * sqrtT) + 1);
  // Delta and gamma decay: the same for a call and a put (they differ by a constant delta of 1).
  const charm = (-pdf * (2 * r * T - d2 * sigma * sqrtT)) / (2 * T * sigma * sqrtT);
  // Gamma is phi(d1) / (S sigma sqrt(T)), so its decay follows from d(d1)/dT.
  const d1Slope = (r + (sigma * sigma) / 2) / (sigma * sqrtT) - d1 / (2 * T);
  const color = gamma * (d1 * d1Slope + 1 / (2 * T));

  return { rho, vanna, vomma, charm, speed, color };
}
