import { loadDotEnv } from "@orionis/config";
loadDotEnv();

import { requireEnv, resolveAddresses, ROBINHOOD_TESTNET_CHAIN_ID } from "@orionis/config";
import { Orionis } from "@orionis/sdk";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "@orionis/config";
import { createKeeper } from "./keeper.js";

const chainId = ROBINHOOD_TESTNET_CHAIN_ID;
const account = privateKeyToAccount(requireEnv("KEEPER_PRIVATE_KEY") as Hex);
const transport = http(requireEnv("RPC_URL"));

const intervalMs = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);
/// Half the oracle's default 1 hour staleness window, so one missed tick does not stall the market.
const refreshSeconds = BigInt(process.env.KEEPER_FEED_REFRESH_SECONDS ?? 1_800);
const refreshFeeds = (process.env.KEEPER_REFRESH_FEEDS ?? "true") !== "false";

const orionis = new Orionis({ chainId, transport, account, addresses: resolveAddresses(chainId) });
const keeper = createKeeper({
  orionis,
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
