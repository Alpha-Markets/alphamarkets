import { formatUnits } from "viem";
import type { Hex, OptionPosition } from "@orionis/types";
import { OptionType } from "@orionis/types";
import { symbolOf } from "./market";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/// "25SEP26" — the expiry part of an option code (PROJECT_BRIEF.md Section 8).
export function expiryCode(expirySeconds: bigint): string {
  const date = new Date(Number(expirySeconds) * 1000);
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${day}${MONTHS[date.getUTCMonth()]}${String(date.getUTCFullYear()).slice(-2)}`;
}

/// `UNDERLYING-EXPIRY-STRIKE-TYPE`, e.g. "NVDA-25SEP26-190-C".
export function optionCode(marketId: Hex, expirySeconds: bigint, strike: bigint, type: OptionType): string {
  const strikeText = String(Number(formatUnits(strike, 18)));
  return `${symbolOf(marketId)}-${expiryCode(expirySeconds)}-${strikeText}-${type === OptionType.CALL ? "C" : "P"}`;
}

export const optionCodeOf = (position: OptionPosition) =>
  optionCode(position.marketId, position.expiry, position.strike, position.optionType);

export function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "–";
  return date.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

/// Spacing between strikes, rounded to the nearest 1, 2 or 5 times a power of ten so that strikes
/// read as clean numbers ("180", "190") rather than "187.3". All bigint, 18 decimals.
function niceStep(raw: bigint): bigint {
  if (raw <= 0n) return 0n;
  const magnitude = 10n ** BigInt(raw.toString().length - 1);
  const candidates = [1n, 2n, 5n, 10n].map((multiple) => multiple * magnitude);
  return candidates.reduce((best, candidate) => {
    const distance = (value: bigint) => (value > raw ? value - raw : raw - value);
    return distance(candidate) < distance(best) ? candidate : best;
  });
}

/// Strikes for the option chain: `rows` on each side of the strike nearest to `spot`, ascending,
/// 18 decimals. The contract has no listed strikes (a series is created on first use), so this is a
/// proposal, not a registry read. Empty when the price or step is unusable.
export function strikeLadder(spot: bigint, stepBps: number, rows: number): bigint[] {
  if (spot <= 0n || stepBps <= 0 || rows < 0) return [];
  const step = niceStep((spot * BigInt(stepBps)) / 10_000n);
  if (step === 0n) return [];
  const centre = ((spot + step / 2n) / step) * step;
  const strikes: bigint[] = [];
  for (let offset = -rows; offset <= rows; offset++) {
    const strike = centre + BigInt(offset) * step;
    if (strike > 0n) strikes.push(strike);
  }
  return strikes;
}

/// Index of the strike closest to `spot`, or -1 for an empty list.
export function nearestStrikeIndex(strikes: bigint[], spot: bigint): number {
  let best = -1;
  let bestDistance = 0n;
  strikes.forEach((strike, index) => {
    const distance = strike > spot ? strike - spot : spot - strike;
    if (best === -1 || distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/// Upcoming expiry timestamps (unix seconds): each of `days` ahead at `hourUtc`, plus any series
/// already opened on chain, future only, ascending, without duplicates.
export function expiryDates(days: number[], nowSeconds: bigint, hourUtc: number, listed: bigint[] = []): bigint[] {
  const dayStart = nowSeconds - (nowSeconds % 86_400n);
  const proposed = days.map((day) => dayStart + BigInt(day) * 86_400n + BigInt(hourUtc) * 3_600n);
  return [...new Set([...proposed, ...listed].filter((expiry) => expiry > nowSeconds))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/// "190" or "187.5": a strike as shown in the option code.
export const strikeText = (strike: bigint) => String(Number(formatUnits(strike, 18)));

/// Quote figures from the pricing service are floats for display only. Premium per underlying unit.
export const fmtQuotePremium = (premium: number) => `$${premium.toFixed(2)}`;
export const fmtQuoteIv = (iv: number) => `${(iv * 100).toFixed(1)}%`;
export const fmtQuoteDelta = (delta: number) => delta.toFixed(2);
