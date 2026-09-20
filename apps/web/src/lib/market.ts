import { hexToString } from "viem";
import type { Hex } from "@alphamarkets/types";

/// Market ids are ASCII right-padded with zero bytes (see `resolveMarketId` in the SDK), so the
/// symbol is recoverable without a lookup table — new markets render with no code change.
export function symbolOf(marketId: Hex): string {
  return hexToString(marketId, { size: 32 }).replace(/\0+$/, "");
}

export const perpLabel = (marketId: Hex) => `${symbolOf(marketId)}-PERP`;
