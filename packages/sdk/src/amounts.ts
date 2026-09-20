import { formatUnits, parseUnits } from "viem";
import { AlphaMarketsError } from "./errors.js";

/// Money and price inputs are either a raw base-unit `bigint` (used as-is) or a decimal string
/// like `"1000.50"` (scaled by the relevant decimals). JS `number` is deliberately not accepted:
/// `0.1 + 0.2` style float error must never reach a transaction (DEVELOPMENT_STEPS.md Phase 3).
export type Amount = bigint | string;

/// Prices, strikes and notionals on the contracts are 18-decimal fixed point
/// (see `MarginEngine.sol`).
export const PRICE_DECIMALS = 18;

export function toBaseUnits(value: Amount, decimals: number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string") {
    throw new AlphaMarketsError(`Amount must be a bigint or decimal string, received ${typeof value}`);
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new AlphaMarketsError(`Invalid decimal amount: "${value}"`);
  }
  return parseUnits(trimmed, decimals);
}

export function fromBaseUnits(value: bigint, decimals: number): string {
  return formatUnits(value, decimals);
}

/// Rescales a base-unit value between decimal precisions (rounds toward zero when narrowing).
export function convertDecimals(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value;
  return fromDecimals > toDecimals
    ? value / 10n ** BigInt(fromDecimals - toDecimals)
    : value * 10n ** BigInt(toDecimals - fromDecimals);
}
