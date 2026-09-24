import { gaussian, type Rng } from "./prng.js";

/// One market's simulated price, in dollars.
export interface MarketModel {
  symbol: string;
  /// The level the price drifts back to. Set once from the feed's price when the simulation first starts.
  anchor: number;
  price: number;
  /// Standard deviation of the random move per step, as a fraction of the price.
  sigma: number;
}

export interface ModelOptions {
  /// How much of each move all markets share, 0 to 1. Tech stocks move together.
  correlation: number;
  /// Fraction of the gap to the anchor that closes each step. Keeps a calm market calm.
  reversion: number;
  /// The random part of a step never exceeds this fraction of the price.
  maxStep: number;
  /// The price never leaves `anchor * (1 ± maxDrift)`, a nudge included.
  maxDrift: number;
}

/// A price move that plays out over several steps, so a "crash" is a run of ticks and not one jump.
export interface Nudge {
  symbol: string;
  remainingSteps: number;
  /// Fraction of the price added each step (negative pushes the price down).
  stepFraction: number;
}

/// Largest move of one step (random or nudge), so no single push looks like a glitch.
export const MAX_NUDGE_STEP = 0.01;

/// The step length the model's numbers are written for. A shorter or longer step scales them, so the
/// market moves the same amount per minute whatever the tick.
export const BASE_TICK_SECONDS = 15;

export const CALM_MARKET: ModelOptions = { correlation: 0.5, reversion: 0.004, maxStep: 0.004, maxDrift: 0.12 };

/// Some stocks move more than others: a multiplier on the base volatility.
export const SYMBOL_VOLATILITY: Record<string, number> = {
  NVDA: 1.2, TSLA: 1.4, AAPL: 0.8, META: 1.0, HOOD: 1.6,
  MSFT: 0.8, GOOGL: 0.9, COIN: 1.7, MSTR: 2.0, SPY: 0.4, QQQ: 0.5, AVGO: 1.2, JPM: 0.7, DIS: 0.8, UBER: 1.1, SHOP: 1.5,
};

/// A sensible per-step volatility: about 0.04% per 15 seconds, roughly 0.7% over an hour.
export const CALM_SIGMA = 0.0004;

/// Plans a nudge of `pct` percent (negative for down) over `seconds`, in steps of `tickSeconds`, and never
/// moving more than `MAX_NUDGE_STEP` per step (so a big nudge may take longer than asked).
export function planNudge(symbol: string, pct: number, seconds: number, tickSeconds = BASE_TICK_SECONDS): Nudge {
  if (!Number.isFinite(pct) || pct === 0) throw new Error("nudge: give a percentage other than 0");
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("nudge: give a duration in seconds above 0");
  const total = pct / 100;
  const count = Math.max(1, Math.ceil(seconds / tickSeconds), Math.ceil(Math.abs(total) / MAX_NUDGE_STEP));
  return { symbol, remainingSteps: count, stepFraction: total / count };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/// Rounds to cents, the resolution of a quoted price.
export function toCents(price: number): number {
  return Math.round(price * 100) / 100;
}

/// One step of every market, `tickSeconds` long. Returns the new models and the nudges still running.
/// Pure: the same inputs and random generator always give the same result.
export function stepMarkets(
  markets: readonly MarketModel[],
  nudges: readonly Nudge[],
  rng: Rng,
  options: ModelOptions = CALM_MARKET,
  tickSeconds = BASE_TICK_SECONDS,
): { markets: MarketModel[]; nudges: Nudge[] } {
  // Volatility grows with the square root of time, a pull back to the anchor with time itself.
  const scale = tickSeconds / BASE_TICK_SECONDS;
  const spread = Math.sqrt(scale);
  const common = gaussian(rng);
  const weightCommon = Math.sqrt(options.correlation);
  const weightOwn = Math.sqrt(1 - options.correlation);

  const next = markets.map((market) => {
    const shock = weightCommon * common + weightOwn * gaussian(rng);
    const pull = (options.reversion * scale * (market.anchor - market.price)) / market.anchor;
    const random = clamp(market.sigma * spread * shock + pull, -options.maxStep * spread, options.maxStep * spread);
    const nudge = nudges.find((n) => n.symbol === market.symbol && n.remainingSteps > 0);
    const move = random + (nudge?.stepFraction ?? 0);
    const price = clamp(
      market.price * (1 + move),
      market.anchor * (1 - options.maxDrift),
      market.anchor * (1 + options.maxDrift),
    );
    return { ...market, price: toCents(price) };
  });

  const remaining = nudges
    .map((n) => ({ ...n, remainingSteps: n.remainingSteps - 1 }))
    .filter((n) => n.remainingSteps > 0);
  return { markets: next, nudges: remaining };
}

/// A dollar price as the feed's 18-decimal integer.
export function toFeedPrice(price: number): bigint {
  return BigInt(Math.round(price * 100)) * 10n ** 16n;
}

/// The inverse, for display and decisions.
export function fromFeedPrice(price: bigint): number {
  return Number(price / 10n ** 14n) / 10_000;
}
