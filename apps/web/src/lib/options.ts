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
