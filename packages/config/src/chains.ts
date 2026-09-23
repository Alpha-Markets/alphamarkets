import type { Chain } from "viem";

/// Robinhood Chain testnet (PROJECT_BRIEF.md Section 4, deployed per
/// packages/contracts/CHANGELOG.md [1.0.0-testnet]).
export const ROBINHOOD_TESTNET_CHAIN_ID = 46_630 as const;

export type ChainId = typeof ROBINHOOD_TESTNET_CHAIN_ID;

/// No RPC URL is baked in; callers supply their own transport. The official endpoint is
/// https://rpc.testnet.chain.robinhood.com (its TLS cert expired at the time of the first deploy,
/// CHANGELOG [1.0.0-testnet], and was valid again on 2026-09-23). Use a paid provider such as
/// Alchemy for anything beyond testnet demos.
export const robinhoodTestnet: Chain = {
  id: ROBINHOOD_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
  // The canonical deterministic deployment, confirmed present on this chain (`eth_getCode`
  // returns real bytecode) — lets the SDK batch reads with `client.multicall` instead of one
  // `readContract` per call, which matters on a rate-limited RPC provider.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
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
    throw new Error(`@alphamarkets/config: chain ${value} has no deployment recorded (supported: ${supported})`);
  }
  return id as ChainId;
}
