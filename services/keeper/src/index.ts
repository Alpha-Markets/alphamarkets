import { loadDotEnv } from "@alphamarkets/config";
loadDotEnv();

import { requireEnv, resolveAddresses, resolveChainId } from "@alphamarkets/config";
import { AlphaMarkets } from "@alphamarkets/sdk";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "@alphamarkets/config";
import { createKeeper } from "./keeper.js";

const chainId = resolveChainId(process.env.CHAIN_ID);
const account = privateKeyToAccount(requireEnv("KEEPER_PRIVATE_KEY") as Hex);
const transport = http(requireEnv("RPC_URL"));

const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);
/// Half the oracle's default 1 hour staleness window, so one missed tick does not stall the market.
const refreshSeconds = BigInt(process.env.KEEPER_FEED_REFRESH_SECONDS ?? 1_800);
const refreshFeeds = (process.env.KEEPER_REFRESH_FEEDS ?? "true") !== "false";

const alphaMarkets = new AlphaMarkets({ chainId, transport, account, addresses: resolveAddresses(chainId) });
const keeper = createKeeper({
  alphaMarkets,
  publicClient: createPublicClient({ chain: chains[chainId], transport }),
  walletClient: createWalletClient({ account, chain: chains[chainId], transport }),
  refreshSeconds,
  refreshFeeds,
});

console.log(`keeper: ${account.address} on chain ${chainId}, every ${intervalMs}ms (feed refresh ${refreshFeeds ? "on" : "off"})`);
for (;;) {
  try {
    await keeper.tick();
  } catch (error) {
    console.error("keeper: tick failed", error);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
