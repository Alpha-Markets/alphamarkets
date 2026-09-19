import type { Address, Hex } from "@orionis/types";
import { OrionisError } from "./errors.js";

/// PROJECT_BRIEF.md Section 43. The base URL is caller-supplied (`NEXT_PUBLIC_EXPLORER_URL` in
/// the frontend) — never hardcoded here.
export interface ExplorerNamespace {
  txUrl(hash: Hex): string;
  addressUrl(address: Address): string;
  blockUrl(blockNumber: bigint | number): string;
}

export function createExplorer(baseUrl?: string): ExplorerNamespace {
  function url(path: string): string {
    if (!baseUrl) {
      throw new OrionisError("explorer: `explorerUrl` was not provided in the Orionis constructor config");
    }
    return `${baseUrl.replace(/\/+$/, "")}/${path}`;
  }

  return {
    txUrl: (hash) => url(`tx/${hash}`),
    addressUrl: (address) => url(`address/${address}`),
    blockUrl: (blockNumber) => url(`block/${blockNumber}`),
  };
}
