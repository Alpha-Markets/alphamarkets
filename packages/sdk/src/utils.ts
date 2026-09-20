import { isHex, stringToHex } from "viem";
import type { Hex } from "@alphamarkets/types";
import { AlphaMarketsError } from "./errors.js";

/// Market ids are `bytes32` — contracts encode them as a raw ASCII string right-padded with
/// zero bytes (see `packages/contracts/script/ConfigureMarkets.s.sol`, `bytes32("NVDA")`),
/// not a keccak256 hash. `stringToHex(value, { size: 32 })` right-pads to match. Accepts a
/// symbol ("NVDA"), a perp market label ("NVDA-PERP", PROJECT_BRIEF.md Section 1), or an
/// already-encoded bytes32 hex string, so callers can pass any of them without knowing the
/// encoding.
export function resolveMarketId(marketIdOrSymbol: string): Hex {
  if (isHex(marketIdOrSymbol) && marketIdOrSymbol.length === 66) {
    return marketIdOrSymbol;
  }
  return stringToHex(marketIdOrSymbol.replace(/-PERP$/i, ""), { size: 32 });
}

export const BPS_DENOMINATOR = 10_000n;

/// Default deadline offset for transactions when the caller does not supply one.
export const DEFAULT_DEADLINE_SECONDS = 300n;

export function defaultDeadline(now: number = Date.now()): bigint {
  return BigInt(Math.floor(now / 1000)) + DEFAULT_DEADLINE_SECONDS;
}

/// Whole-number inputs that are counts or multipliers, not money (leverage, contracts).
export function toInteger(value: bigint | number, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isInteger(value) || value < 0) {
    throw new AlphaMarketsError(`${label} must be a non-negative integer, received ${value}`);
  }
  return BigInt(value);
}

/// Accepts a unix-seconds `bigint`, a `Date`, or an ISO date string ("2026-09-25").
export function toUnixSeconds(value: bigint | Date | string): bigint {
  if (typeof value === "bigint") return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AlphaMarketsError(`Invalid expiry: ${String(value)}`);
  }
  return BigInt(Math.floor(date.getTime() / 1000));
}
