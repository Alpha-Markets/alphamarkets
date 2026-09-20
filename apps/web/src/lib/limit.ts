import { parseUnits } from "viem";
import { PRICE_DECIMALS, fmtPrice } from "./format";

/// How long a resting limit order stays live.
export const LIMIT_EXPIRIES = ["1h", "24h", "7d"] as const;
export type LimitExpiry = (typeof LIMIT_EXPIRIES)[number];

const SECONDS: Record<LimitExpiry, number> = { "1h": 3_600, "24h": 86_400, "7d": 604_800 };
export const limitExpirySeconds = (expiry: LimitExpiry) => SECONDS[expiry];

/// A positive decimal price with at most 18 decimals, as an exact string; `undefined` for anything
/// else (empty, zero, negative, scientific notation, too many decimals).
export function parseLimitPrice(text: string): string | undefined {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  if ((trimmed.split(".")[1]?.length ?? 0) > PRICE_DECIMALS) return undefined;
  return parseUnits(trimmed, PRICE_DECIMALS) > 0n ? trimmed : undefined;
}

/// When the trigger is already on the fill side of the mark, the order fills at the current price
/// on the keeper's next pass rather than waiting. Say so, since it is not what most people expect
/// from a limit order. `null` when there is nothing to warn about.
export function limitDirectionNote(isLong: boolean, trigger: string | undefined, mark: bigint): string | null {
  if (trigger === undefined) return null;
  const price = parseUnits(trigger, PRICE_DECIMALS);
  const reached = isLong ? mark <= price : mark >= price;
  return reached ? `The mark (${fmtPrice(mark)}) has already reached this price, so it fills at the current price within moments.` : null;
}
