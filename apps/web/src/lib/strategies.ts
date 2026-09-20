import type { StrategyKind, StrategyStrikes } from "@alphamarkets/sdk";

export const STRATEGY_LABEL: Record<StrategyKind, string> = {
  COVERED_CALL: "Covered call",
  PROTECTIVE_PUT: "Protective put",
  BULL_CALL_SPREAD: "Bull call spread",
  BEAR_PUT_SPREAD: "Bear put spread",
  STRADDLE: "Straddle",
  STRANGLE: "Strangle",
  IRON_CONDOR: "Iron condor",
};

/// One line of plain description per strategy, shown under the picker.
export const STRATEGY_SUMMARY: Record<StrategyKind, string> = {
  COVERED_CALL: "Long the underlying, short a call above the price. Caps the upside for a premium.",
  PROTECTIVE_PUT: "Long the underlying, long a put below the price. Floors the loss for a premium.",
  BULL_CALL_SPREAD: "Long a call, short a higher call. A capped bet on a rise.",
  BEAR_PUT_SPREAD: "Long a put, short a lower put. A capped bet on a fall.",
  STRADDLE: "Long a call and a put at one strike. Profits from a big move either way.",
  STRANGLE: "Long a put below and a call above the price. A cheaper bet on a big move.",
  IRON_CONDOR: "Short a put and a call near the price, long a put and a call further out. Profits when the price stays put.",
};

/// The strike fields each strategy needs, in the order `strikesFromValues` expects them.
export const STRATEGY_FIELDS: Record<StrategyKind, string[]> = {
  COVERED_CALL: ["Call strike"],
  PROTECTIVE_PUT: ["Put strike"],
  BULL_CALL_SPREAD: ["Low strike (long)", "High strike (short)"],
  BEAR_PUT_SPREAD: ["Low strike (short)", "High strike (long)"],
  STRADDLE: ["Strike"],
  STRANGLE: ["Put strike", "Call strike"],
  IRON_CONDOR: ["Long put", "Short put", "Short call", "Long call"],
};

/// Rungs of the strike ladder, relative to the one nearest the price, that each field starts on.
const OFFSETS: Record<StrategyKind, number[]> = {
  COVERED_CALL: [1],
  PROTECTIVE_PUT: [-1],
  BULL_CALL_SPREAD: [0, 1],
  BEAR_PUT_SPREAD: [-1, 0],
  STRADDLE: [0],
  STRANGLE: [-1, 1],
  IRON_CONDOR: [-2, -1, 1, 2],
};

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/// Starting strikes for a strategy: the ladder rungs around the one nearest the price. On a
/// ladder too short to give distinct rungs, the values may repeat; the builder then reports it.
export function defaultStrikeValues(kind: StrategyKind, ladder: number[], nearest: number): number[] {
  if (ladder.length === 0) return [];
  return OFFSETS[kind].map((offset) => ladder[clamp(nearest + offset, 0, ladder.length - 1)]!);
}

export function strikesFromValues(kind: StrategyKind, values: number[]): StrategyStrikes {
  const [a, b, c, d] = values;
  switch (kind) {
    case "COVERED_CALL":
      return { callStrike: a };
    case "PROTECTIVE_PUT":
      return { putStrike: a };
    case "BULL_CALL_SPREAD":
    case "BEAR_PUT_SPREAD":
      return { lowStrike: a, highStrike: b };
    case "STRADDLE":
      return { strike: a };
    case "STRANGLE":
      return { putStrike: a, callStrike: b };
    case "IRON_CONDOR":
      return a === undefined || b === undefined || c === undefined || d === undefined ? {} : { wings: [a, b, c, d] };
  }
}

/// "+12.50" or "−3.20": a signed dollar amount for the result rows.
export const fmtSignedUsd = (value: number) => `${value < 0 ? "−" : "+"}$${Math.abs(value).toFixed(2)}`;

/// A max profit or loss, where `null` means the strategy has no limit.
export const fmtLimit = (value: number | null) => (value === null ? "Unlimited" : `$${value.toFixed(2)}`);

/// Net premium as a debit (paid) or credit (received).
export const fmtNet = (netPremium: number) => (netPremium >= 0 ? `$${netPremium.toFixed(2)} debit` : `$${Math.abs(netPremium).toFixed(2)} credit`);

/// The price window a payoff chart covers: wide enough to show every strike and break-even with
/// some room, never below zero.
export function chartRange(strikes: number[], breakEvens: number[], spot: number): [number, number] {
  const all = [spot, ...strikes, ...breakEvens].filter((value) => Number.isFinite(value) && value > 0);
  const low = Math.min(...all);
  const high = Math.max(...all);
  const pad = Math.max((high - low) * 0.25, spot * 0.05);
  return [Math.max(low - pad, 0), high + pad];
}
