import { chains as sdkChains } from "@alphamarkets/config";
// `injected` comes from the package root: the `wagmi/connectors` barrel pulls in every wallet SDK
// (Coinbase, Base, ...) and their optional dependencies, none of which the terminal uses.
import { createConfig, http, injected } from "wagmi";
import { defineChain } from "viem";
import { env } from "./env";

/// The SDK's chain record supplies id, name and currency; the RPC and explorer come from the
/// environment, never from code.
export const chain = defineChain({
  ...sdkChains[env.chainId],
  rpcUrls: { default: { http: [env.rpcUrl] } },
  blockExplorers: env.explorerUrl ? { default: { name: "Explorer", url: env.explorerUrl } } : undefined,
});

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(env.readRpcUrl) },
  ssr: true,
});
