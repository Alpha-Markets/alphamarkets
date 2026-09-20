import type { Address } from "@orionis/types";
import { ROBINHOOD_TESTNET_CHAIN_ID, type ChainId } from "./chains.js";

export interface ContractAddresses {
  marketRegistry: Address;
  oracleRouter: Address;
  vault: Address;
  collateralManager: Address;
  feeManager: Address;
  buybackModule: Address;
  riskManager: Address;
  optionsEngine: Address;
  optionMarket: Address;
  optionPositionManager: Address;
  perpsEngine: Address;
  perpPositionManager: Address;
  /// Absent on deployments made before limit orders (`[1.1.0-testnet]` and earlier); the SDK
  /// reports limit orders as unavailable there instead of calling a contract that lacks them.
  perpOrderManager?: Address;
  liquidationEngine: Address;
  fundingManager: Address;
  priceValidator: Address;
  settlementToken: Address;
}

/// Contracts a deployment may not have, because they were added after it was made. They are absent
/// from the recorded literal below until a deployment includes them, but `ORIONIS_ADDRESSES` may
/// still supply them (a local or fresh deployment).
export const OPTIONAL_CONTRACTS = ["perpOrderManager"] as const satisfies ReadonlyArray<keyof ContractAddresses>;

/// Mirrors `packages/contracts/deployments/robinhood_testnet.json`. Kept as a checked-in
/// literal rather than read from disk at build time — there is no deploy-to-config sync step
/// yet, so this must be updated by hand whenever that file changes (see CHANGELOG entry for
/// the deploy that produced it).
const robinhoodTestnetAddresses: ContractAddresses = {
  marketRegistry: "0x68C4dfB2261A9CAeaE8508C46257857472052384",
  oracleRouter: "0x1A9A537E10D695cEeC34FaBC59f34d870e3700Ce",
  vault: "0x6b38EB431823C82E7899047514411225BF95529C",
  collateralManager: "0x0C959E641B3FFeEA76C5fDbc659311b64C8a1fc3",
  feeManager: "0x8E29a239E94FF68858a4Bc21ee3c7cB787231cbe",
  buybackModule: "0xc729D0a026dc3CfC378Abf1597499511793b2a98",
  riskManager: "0x06D339536a40788f18E864CCaeCE0D0B795c41B4",
  optionsEngine: "0xAD4841566bE45c03287d01EAaF4a46cDF0d069E9",
  optionMarket: "0x607035E17CC6a6945478A5D9371bD69BE1daA9B7",
  optionPositionManager: "0x7eC3Ff91bDc72C15dc8762791122C8C91e230166",
  perpsEngine: "0xAEaE876e34A379Ea5B9B741FA955299029217b33",
  perpPositionManager: "0x814A79499E0919aC74334BE7F9e2A1e07d75fBc9",
  liquidationEngine: "0xD18349e34e618bCEEcf886977740E6673c7CbE18",
  fundingManager: "0x9a851D02b16490b03a14C9Df2B0aDa8b00B85B7c",
  priceValidator: "0x2F2E20EdA39Bc30537Ad6D13267Ed0784a3C21Dd",
  settlementToken: "0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112",
  perpOrderManager: "0x9fb41f7601789486910DBF3A309cb439c91c92BD",
};

export const deployments: Record<ChainId, ContractAddresses> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetAddresses,
};

export function addressesForChain(chainId: ChainId): ContractAddresses {
  const addresses = deployments[chainId];
  if (!addresses) {
    throw new Error(`@orionis/config: no deployment recorded for chain ${chainId}`);
  }
  return addresses;
}

/// The recorded deployment for `chainId`, with any addresses in the `ORIONIS_ADDRESSES`
/// environment variable (a JSON object of `ContractAddresses` keys) replacing the recorded ones
/// for those contracts only. This lets backend services and staging point at a fresh deployment
/// (a redeploy, a local Anvil node) without editing checked-in code. Unknown keys and malformed
/// addresses are rejected rather than silently ignored — a typo here would otherwise send
/// requests to the wrong contract.
export function resolveAddresses(
  chainId: ChainId,
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : process.env,
): ContractAddresses {
  const recorded = addressesForChain(chainId);
  const raw = env.ORIONIS_ADDRESSES;
  if (!raw) return recorded;

  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("@orionis/config: ORIONIS_ADDRESSES is not valid JSON");
  }

  const resolved = { ...recorded };
  for (const [key, value] of Object.entries(overrides)) {
    const known = key in recorded || (OPTIONAL_CONTRACTS as readonly string[]).includes(key);
    if (!known) throw new Error(`@orionis/config: ORIONIS_ADDRESSES has unknown contract "${key}"`);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`@orionis/config: ORIONIS_ADDRESSES.${key} is not an address`);
    }
    resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}
