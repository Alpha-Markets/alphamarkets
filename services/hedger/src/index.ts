import { loadDotEnv } from "@orionis/config";
loadDotEnv();

import { requireEnv, resolveAddresses, ROBINHOOD_TESTNET_CHAIN_ID } from "@orionis/config";
import { Orionis } from "@orionis/sdk";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createHedger } from "./hedger.js";

const chainId = ROBINHOOD_TESTNET_CHAIN_ID;
const account = privateKeyToAccount(requireEnv("HEDGER_PRIVATE_KEY") as Hex);
const market = requireEnv("HEDGER_MARKET");
const intervalMs = Number(process.env.HEDGER_INTERVAL_MS ?? 60_000);
/// Off unless explicitly turned on: a hedger that trades by default would open positions the first
/// time someone starts it to look at what it does.
const execute = process.env.HEDGER_EXECUTE === "true";

const orionis = new Orionis({
  chainId,
  transport: http(requireEnv("RPC_URL")),
  account,
  addresses: resolveAddresses(chainId),
  apiUrl: requireEnv("API_URL"),
});
const hedger = createHedger({
  orionis,
  account: account.address,
  market,
  targetDelta: Number(process.env.HEDGER_TARGET_DELTA ?? 0),
  toleranceUnits: Number(process.env.HEDGER_TOLERANCE_UNITS ?? 1),
  minNotional: BigInt(process.env.HEDGER_MIN_NOTIONAL ?? 0),
  leverage: Number(process.env.HEDGER_LEVERAGE ?? 2),
  execute,
});

console.log(`hedger: ${account.address} hedging ${market} every ${intervalMs}ms (${execute ? "TRADING" : "dry run"})`);
for (;;) {
  try {
    await hedger.tick();
  } catch (error) {
    console.error("hedger: tick failed", error);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}
