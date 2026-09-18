/// European option pricing (PROJECT_BRIEF.md Section 8: European Call/Put, cash-settled) —
/// display/quoting only (Section 10: "Offchain analytics must never become the sole source
/// of settlement truth"). Actual settlement uses the intrinsic-value formula in
/// `packages/contracts/src/options/OptionSettlement.sol`, not this.
///
/// Two inputs here are placeholders, not product decisions:
/// - Risk-free rate is assumed 0 — no rate source exists for this testnet.
/// - Volatility is `DEFAULT_IV_BPS` (flat, per-deployment, not per-market) — there is no
///   live options order book or vol surface to derive one from. The `iv` field in the
///   response is this assumed input, not a market-implied value (nothing to imply it from).
/// Both should be replaced once product supplies a real source, matching the flagged-not-
/// invented pattern `packages/contracts/script/ConfigureMarkets.s.sol` already uses for its
/// placeholder fee schedule.

export type OptionType = "CALL" | "PUT";

export interface QuoteInput {
  spot: number;
  strike: number;
  /// Years to expiry (already converted from a unix timestamp by the caller).
  timeToExpiryYears: number;
  volatility: number;
  riskFreeRate: number;
  optionType: OptionType;
}

export interface QuoteResult {
  premium: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  breakEven: number;
}

/// Abramowitz & Stegun 7.1.26 approximation — accurate to ~1.5e-7, more than enough for a
/// display-only quote.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPdf(x: number): number {
  return Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI);
}

export function quote(input: QuoteInput): QuoteResult {
  const { spot: S, strike: K, timeToExpiryYears: T, volatility: sigma, riskFreeRate: r, optionType } = input;

  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    throw new Error("blackScholes.quote: spot, strike, volatility, and time to expiry must all be positive");
  }

  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const discountedK = K * Math.exp(-r * T);

  const isCall = optionType === "CALL";
  const premium = isCall
    ? S * normCdf(d1) - discountedK * normCdf(d2)
    : discountedK * normCdf(-d2) - S * normCdf(-d1);

  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = normPdf(d1) / (S * sigma * sqrtT);
  const vega = S * normPdf(d1) * sqrtT;
  const theta = isCall
    ? -((S * normPdf(d1) * sigma) / (2 * sqrtT)) - r * discountedK * normCdf(d2)
    : -((S * normPdf(d1) * sigma) / (2 * sqrtT)) + r * discountedK * normCdf(-d2);

  const breakEven = isCall ? K + premium : K - premium;

  return { premium, iv: sigma, delta, gamma, theta, vega, breakEven };
}
