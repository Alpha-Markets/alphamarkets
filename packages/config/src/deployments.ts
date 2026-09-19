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
  liquidationEngine: Address;
  fundingManager: Address;
  priceValidator: Address;
  settlementToken: Address;
}

/// Mirrors `packages/contracts/deployments/robinhood_testnet.json`. Kept as a checked-in
/// literal rather than read from disk at build time — there is no deploy-to-config sync step
/// yet, so this must be updated by hand whenever that file changes (see CHANGELOG entry for
/// the deploy that produced it).
const robinhoodTestnetAddresses: ContractAddresses = {
  marketRegistry: "0x027D56C99D9E486F8911F0bd58EE508a817E9c0e",
  oracleRouter: "0x1203d1d05ae5DA1DE18752680B525F7CB0b5aFb0",
  vault: "0x9F05fd9F0fE15fEbBd6EDcd7D63f4D0bCe7d3c1b",
  collateralManager: "0x760E82300F3E2095Ae2E04318a0ef03cb693d52c",
  feeManager: "0xa8fF53Fb41Bbf90B79f8c45B1576BB6F93Dc45c3",
  buybackModule: "0x9Ae0Ebf31ee39F74bB412f80c4F7dcA953abBCFf",
  riskManager: "0x2aFdFE61A5222609865Ca46BFAC90c0a35Bf5870",
  optionsEngine: "0x1cC0612e39c1977daA7CFA4F031807b66D26a632",
  optionMarket: "0x5341E0C1bb61D4f776B99afE332912A4502112b4",
  optionPositionManager: "0x566A18Be08fB6Df937F461741985503cE3f8486F",
  perpsEngine: "0x563b532ee62FbC2C8344626934959B132Bf95786",
  perpPositionManager: "0x1d8A3f6b8E720dE6cF7Bf8cDa8A7aEc32fb9Cac6",
  liquidationEngine: "0x13ed3961E2C518a5db9dFc29e895CAbAe6DE09A4",
  fundingManager: "0xF7E00Bbe120a88137536C69e3ad01aC96807B51C",
  priceValidator: "0x413f505814A0175bb7551EFb966c0580345EbF9F",
  settlementToken: "0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112",
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
    if (!(key in recorded)) throw new Error(`@orionis/config: ORIONIS_ADDRESSES has unknown contract "${key}"`);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`@orionis/config: ORIONIS_ADDRESSES.${key} is not an address`);
    }
    resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}
