/// Options strategy builder (PROJECT_BRIEF.md Section 41): the seven strategies the brief lists,
/// with net premium, max profit, max loss, break-evens, Greeks and payoff at expiry.
///
/// Analytics only, like `services/pricing`: it works in plain numbers (per unit of the underlying)
/// for display and charts, and never produces a value that is signed or charged. What an order
/// costs comes from a signed quote (`options.previewOpen`), and settlement comes from the oracle.
///
/// Execution limits of the current contracts: `OptionsEngine` only lets a user BUY options, so
/// any leg that is a short option (covered call, bull call spread, bear put spread, iron condor)
/// can be analysed here but not opened onchain. `analyzeStrategy(...).executable` says which.
/// A long underlying leg is a 1x long perp position.

import { OrionisError } from "./errors.js";

export type StrategyKind =
  | "COVERED_CALL"
  | "PROTECTIVE_PUT"
  | "BULL_CALL_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "STRADDLE"
  | "STRANGLE"
  | "IRON_CONDOR";

export const STRATEGY_KINDS: StrategyKind[] = [
  "COVERED_CALL",
  "PROTECTIVE_PUT",
  "BULL_CALL_SPREAD",
  "BEAR_PUT_SPREAD",
  "STRADDLE",
  "STRANGLE",
  "IRON_CONDOR",
];

export type LegKind = "CALL" | "PUT" | "UNDERLYING";
export type LegSide = "LONG" | "SHORT";

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

/// One leg of a strategy, per unit of the underlying. `price` is what one unit costs (a long leg
/// pays it) or brings in (a short leg receives it): the ask for a long option, the bid for a short
/// one, and the entry price for the underlying.
export interface Leg {
  kind: LegKind;
  side: LegSide;
  /// Absent for the underlying.
  strike?: number;
  quantity: number;
  price: number;
  /// Per unit, as the long position would have them; the sign flips for a short leg.
  greeks?: Greeks;
}

/// What the builder needs to know about one option. `bid` and `ask` fall back to `mark`.
export interface OptionQuote {
  mark: number;
  bid?: number;
  ask?: number;
  greeks?: Greeks;
}

export type QuoteLookup = (type: "CALL" | "PUT", strike: number) => OptionQuote;

export interface StrategyParams {
  /// Current price of the underlying: the entry price of any underlying leg.
  spot: number;
  /// Units of the underlying (or contracts times contract size) per leg. Defaults to 1.
  quantity?: number;
  quote: QuoteLookup;
}

export interface StrategyStrikes {
  /// Covered call, straddle. The call strike of a covered call; the shared strike of a straddle.
  strike?: number;
  /// Protective put, strangle: the put strike. Also the lower strike of a spread.
  putStrike?: number;
  callStrike?: number;
  lowStrike?: number;
  highStrike?: number;
  /// Iron condor: long put, short put, short call, long call, in ascending order.
  wings?: [number, number, number, number];
}

export interface StrategyAnalysis {
  legs: Leg[];
  /// Positive: money paid (a debit). Negative: money received (a credit).
  netPremium: number;
  /// `null` means unlimited.
  maxProfit: number | null;
  /// A positive number (the most that can be lost), or `null` for unlimited.
  maxLoss: number | null;
  breakEvens: number[];
  greeks: Greeks;
  /// Profit or loss at expiry when the underlying settles at `price`, including the premium.
  payoffAt(price: number): number;
  /// False when a leg is a short option, which the contracts cannot open yet.
  executable: boolean;
}

const sign = (side: LegSide) => (side === "LONG" ? 1 : -1);

const optionPrice = (quote: OptionQuote, side: LegSide) => (side === "LONG" ? (quote.ask ?? quote.mark) : (quote.bid ?? quote.mark));

function optionLeg(params: StrategyParams, kind: "CALL" | "PUT", side: LegSide, strike: number): Leg {
  if (!Number.isFinite(strike) || strike <= 0) throw new OrionisError(`strategies: a ${kind} strike must be above zero`);
  const quote = params.quote(kind, strike);
  return { kind, side, strike, quantity: params.quantity ?? 1, price: optionPrice(quote, side), greeks: quote.greeks };
}

function underlyingLeg(params: StrategyParams, side: LegSide): Leg {
  return { kind: "UNDERLYING", side, quantity: params.quantity ?? 1, price: params.spot, greeks: { delta: 1, gamma: 0, theta: 0, vega: 0 } };
}

function need<T>(value: T | undefined, kind: StrategyKind, name: string): T {
  if (value === undefined) throw new OrionisError(`strategies: ${kind} needs ${name}`);
  return value;
}

function ascending(kind: StrategyKind, low: number, high: number, what: string) {
  if (!(low < high)) throw new OrionisError(`strategies: ${kind} needs ${what} to be below the higher strike`);
}

/// The legs of a named strategy at the given strikes.
export function strategyLegs(kind: StrategyKind, strikes: StrategyStrikes, params: StrategyParams): Leg[] {
  switch (kind) {
    case "COVERED_CALL":
      return [underlyingLeg(params, "LONG"), optionLeg(params, "CALL", "SHORT", need(strikes.callStrike ?? strikes.strike, kind, "a call strike"))];
    case "PROTECTIVE_PUT":
      return [underlyingLeg(params, "LONG"), optionLeg(params, "PUT", "LONG", need(strikes.putStrike ?? strikes.strike, kind, "a put strike"))];
    case "BULL_CALL_SPREAD": {
      const low = need(strikes.lowStrike, kind, "a low strike");
      const high = need(strikes.highStrike, kind, "a high strike");
      ascending(kind, low, high, "the low strike");
      return [optionLeg(params, "CALL", "LONG", low), optionLeg(params, "CALL", "SHORT", high)];
    }
    case "BEAR_PUT_SPREAD": {
      const low = need(strikes.lowStrike, kind, "a low strike");
      const high = need(strikes.highStrike, kind, "a high strike");
      ascending(kind, low, high, "the low strike");
      return [optionLeg(params, "PUT", "LONG", high), optionLeg(params, "PUT", "SHORT", low)];
    }
    case "STRADDLE": {
      const strike = need(strikes.strike, kind, "a strike");
      return [optionLeg(params, "CALL", "LONG", strike), optionLeg(params, "PUT", "LONG", strike)];
    }
    case "STRANGLE": {
      const put = need(strikes.putStrike, kind, "a put strike");
      const call = need(strikes.callStrike, kind, "a call strike");
      ascending(kind, put, call, "the put strike");
      return [optionLeg(params, "PUT", "LONG", put), optionLeg(params, "CALL", "LONG", call)];
    }
    case "IRON_CONDOR": {
      const wings = need(strikes.wings, kind, "four strikes (long put, short put, short call, long call)");
      const [longPut, shortPut, shortCall, longCall] = wings;
      ascending(kind, longPut, shortPut, "the long put");
      ascending(kind, shortPut, shortCall, "the short put");
      ascending(kind, shortCall, longCall, "the short call");
      return [
        optionLeg(params, "PUT", "LONG", longPut),
        optionLeg(params, "PUT", "SHORT", shortPut),
        optionLeg(params, "CALL", "SHORT", shortCall),
        optionLeg(params, "CALL", "LONG", longCall),
      ];
    }
  }
}

function legPayoff(leg: Leg, price: number): number {
  const s = sign(leg.side);
  const gross =
    leg.kind === "UNDERLYING" ? price : leg.kind === "CALL" ? Math.max(price - leg.strike!, 0) : Math.max(leg.strike! - price, 0);
  // A long option starts by paying `price`, a long underlying by paying the entry price.
  return s * leg.quantity * (gross - leg.price);
}

/// The value at expiry of a set of legs, with the premium already counted.
export function payoffAt(legs: Leg[], price: number): number {
  return legs.reduce((sum, leg) => sum + legPayoff(leg, price), 0);
}

/// Payoff slope as the price goes to infinity: only the underlying and calls still move.
function farSlope(legs: Leg[]): number {
  return legs.reduce((sum, leg) => (leg.kind === "PUT" ? sum : sum + sign(leg.side) * leg.quantity), 0);
}

const EPS = 1e-9;

/// Net premium, max profit and loss, break-evens, Greeks and payoff of any set of legs. The payoff
/// is piecewise linear with kinks at the strikes, so its extremes and zero crossings are found
/// exactly from the strikes, the zero price, and the slope at the far end.
export function analyzeStrategy(legs: Leg[]): StrategyAnalysis {
  if (legs.length === 0) throw new OrionisError("strategies: a strategy needs at least one leg");
  for (const leg of legs) {
    if (!(leg.quantity > 0)) throw new OrionisError("strategies: every leg needs a quantity above zero");
    if (leg.kind !== "UNDERLYING" && (leg.strike === undefined || !(leg.strike > 0))) throw new OrionisError("strategies: an option leg needs a strike");
  }

  const strikes = [...new Set(legs.flatMap((leg) => (leg.strike === undefined ? [] : [leg.strike])))].sort((a, b) => a - b);
  const points = [0, ...strikes];
  const values = points.map((price) => payoffAt(legs, price));
  const slope = farSlope(legs);

  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  const maxProfit = slope > EPS ? null : highest;
  const maxLoss = slope < -EPS ? null : -lowest;

  // Zero crossings between consecutive kinks, then past the last kink along the far slope.
  const breakEvens: number[] = [];
  // A payoff that is zero everywhere has no single break-even to report.
  const alwaysZero = Math.abs(slope) < EPS && values.every((value) => Math.abs(value) < EPS);
  const push = (price: number) => {
    if (price >= 0 && !breakEvens.some((known) => Math.abs(known - price) < 1e-7)) breakEvens.push(price);
  };
  for (let i = 0; i < points.length && !alwaysZero; i++) {
    const value = values[i]!;
    if (Math.abs(value) < EPS) push(points[i]!);
    if (i === points.length - 1) break;
    const next = values[i + 1]!;
    if ((value < -EPS && next > EPS) || (value > EPS && next < -EPS)) {
      push(points[i]! + (-value * (points[i + 1]! - points[i]!)) / (next - value));
    }
  }
  const last = values[values.length - 1]!;
  if (Math.abs(slope) > EPS && last * slope < -EPS) push(points[points.length - 1]! + -last / slope);
  breakEvens.sort((a, b) => a - b);

  const greeks = legs.reduce<Greeks>(
    (sum, leg) => {
      const g = leg.greeks;
      const s = sign(leg.side) * leg.quantity;
      return g
        ? { delta: sum.delta + s * g.delta, gamma: sum.gamma + s * g.gamma, theta: sum.theta + s * g.theta, vega: sum.vega + s * g.vega }
        : sum;
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );

  const netPremium = legs.reduce((sum, leg) => (leg.kind === "UNDERLYING" ? sum : sum + sign(leg.side) * leg.quantity * leg.price), 0);

  return {
    legs,
    netPremium,
    maxProfit,
    maxLoss,
    breakEvens,
    greeks,
    payoffAt: (price) => payoffAt(legs, price),
    executable: legs.every((leg) => leg.kind === "UNDERLYING" ? leg.side === "LONG" : leg.side === "LONG"),
  };
}

/// Builds and analyses a named strategy in one call.
export function buildStrategy(kind: StrategyKind, strikes: StrategyStrikes, params: StrategyParams): StrategyAnalysis {
  return analyzeStrategy(strategyLegs(kind, strikes, params));
}

/// Evenly spaced `[price, payoff]` points for a chart, from `low` to `high` inclusive.
export function payoffCurve(legs: Leg[], low: number, high: number, points = 61): Array<[number, number]> {
  if (!(high > low) || points < 2) throw new OrionisError("strategies: payoffCurve needs high above low and at least 2 points");
  return Array.from({ length: points }, (_, i) => {
    const price = low + ((high - low) * i) / (points - 1);
    return [price, payoffAt(legs, price)] as [number, number];
  });
}
