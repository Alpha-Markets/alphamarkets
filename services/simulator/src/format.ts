import { AlphaMarketsContractError } from "@alphamarkets/sdk";
import { formatUnits, hexToString, type Hex } from "viem";

/// One line a person can act on: the contract error's name, viem's short message, or the first line.
export function describe(error: unknown): string {
  if (error instanceof AlphaMarketsContractError) return error.errorName;
  const { shortMessage, message } = error as { shortMessage?: string; message?: string };
  return shortMessage ?? message?.split("\n")[0] ?? String(error);
}

/// "NVDA" from the bytes32 market id.
export function symbolOf(marketId: Hex): string {
  return hexToString(marketId, { size: 32 }).replace(/\0+$/, "");
}

/// A token amount as a plain number of dollars (the settlement token is a dollar stand-in).
export function dollars(amount: bigint, decimals: number): number {
  return Number(formatUnits(amount, decimals));
}

export function usd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}
