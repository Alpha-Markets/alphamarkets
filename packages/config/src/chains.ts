import type { Chain } from "viem";

/// Robinhood Chain testnet (PROJECT_BRIEF.md Section 4, deployed per
/// packages/contracts/CHANGELOG.md [1.0.0-testnet]).
export const ROBINHOOD_TESTNET_CHAIN_ID = 46_630 as const;

export type ChainId = typeof ROBINHOOD_TESTNET_CHAIN_ID;

/// No RPC URL is baked in — every deploy on Robinhood's own default RPC hit an expired TLS
/// cert (CHANGELOG [1.0.0-testnet]), so callers must supply their own transport (e.g. Alchemy).
export const robinhoodTestnet: Chain = {
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
};

export const chains: Record<ChainId, Chain> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnet,
};

/// The chain a service or app runs against, from its `CHAIN_ID` (`NEXT_PUBLIC_CHAIN_ID` in the web
/// app). Unset means the only chain with a recorded deployment today. A value with no entry in
/// `chains` is an error, not a silent fallback: pointing at the wrong chain would send real
/// transactions to the wrong network.
export function resolveChainId(value?: string): ChainId {
  if (value === undefined || value.trim() === "") return ROBINHOOD_TESTNET_CHAIN_ID;
  const id = Number(value);
  if (!Number.isInteger(id) || !(id in chains)) {
    const supported = Object.keys(chains).join(", ");
    throw new Error(`@orionis/config: chain ${value} has no deployment recorded (supported: ${supported})`);
  }
  return id as ChainId;
}
