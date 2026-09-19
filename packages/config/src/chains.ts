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
