import type { Address } from "@alphamarkets/types";
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
  /// Absent on deployments made before `[1.3.0]`: the loss buffer that pays a liquidated position's
  /// shortfall (Phase 7, clearing).
  insuranceFund?: Address;
  /// Absent before `[1.3.0]`: account-level margin, other collateral and portfolio margin.
  crossMargin?: Address;
  /// Absent before `[1.3.0]`: creates subaccounts.
  subaccountFactory?: Address;
  /// Absent before `[1.3.0]`: request-for-quote and block trades for perps.
  rfqManager?: Address;
  liquidationEngine: Address;
  fundingManager: Address;
  priceValidator: Address;
  settlementToken: Address;
}

/// Contracts a deployment may not have, because they were added after it was made. They are absent
/// from the recorded literal below until a deployment includes them, but `ALPHAMARKETS_ADDRESSES` may
/// still supply them (a local or fresh deployment).
export const OPTIONAL_CONTRACTS = ["perpOrderManager", "insuranceFund", "crossMargin", "subaccountFactory", "rfqManager"] as const satisfies ReadonlyArray<keyof ContractAddresses>;

/// Mirrors `packages/contracts/deployments/robinhood_testnet.json`. Kept as a checked-in
/// literal rather than read from disk at build time — there is no deploy-to-config sync step
/// yet, so this must be updated by hand whenever that file changes (see CHANGELOG entry for
/// the deploy that produced it).
const robinhoodTestnetAddresses: ContractAddresses = {
  marketRegistry: "0xb87fd9Caa50e13F9Be66e8B20E2E7ff6881978ea",
  oracleRouter: "0xEC69d88bd7087599a42Bb66b5CF5E37103AE7a44",
  vault: "0x4d33A0A4B2b8d18Aadb1aEa325C46A4147b8f5cB",
  collateralManager: "0x26F4E54735b608520441d481927E01bC5dD64F97",
  feeManager: "0x91f32451000F9c506eBdFC9f20DcBd17fAF806CB",
  buybackModule: "0xccF3B81e6cc3A0B29B4b9BF2240979C2DD5f470e",
  riskManager: "0x2058eBA4B711282bAb82179F241dB04DdECc5FB3",
  optionsEngine: "0xceb57470bac989Db605f73C608fCAd4A6420C576",
  optionMarket: "0x61Ad7EcC224088dC6d3c7e78D83aB5bf71dba8Ee",
  optionPositionManager: "0x42ee6631c48FAb50Cf6065Ad22D286cBf96E537d",
  perpsEngine: "0x8d80Ab71A773B516E3b5CEb51de99717c0F1C5a1",
  perpPositionManager: "0xC3805D46fF734B65DfBd1117770D058188778315",
  liquidationEngine: "0x725d8b6d2d8522D8F218B1f6B1482D403fB80b07",
  fundingManager: "0x51d889e99751046112C3e9B548E653aa04A3a5b9",
  priceValidator: "0x9192bA91C97293d93fbaa63c746Abe8085365E9d",
  settlementToken: "0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112",
  perpOrderManager: "0xd6FD86e71FDE619516601729C441D3d015fF5247",
  insuranceFund: "0xE25f898a55090BC91b9C5ed119Da11D211181e31",
  crossMargin: "0xE328D674734D69c47c1e0b1dC78CB78e5c42d29A",
  subaccountFactory: "0x0E4Df209df0A09898f0Ee8cb7E45EF5952C1e289",
  rfqManager: "0x98DfBF62399819A508ECFD0E4b605F015970A19e",
};

export const deployments: Record<ChainId, ContractAddresses> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetAddresses,
};

export function addressesForChain(chainId: ChainId): ContractAddresses {
  const addresses = deployments[chainId];
  if (!addresses) {
    throw new Error(`@alphamarkets/config: no deployment recorded for chain ${chainId}`);
  }
  return addresses;
}

/// The recorded deployment for `chainId`, with any addresses in the `ALPHAMARKETS_ADDRESSES`
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
  const raw = env.ALPHAMARKETS_ADDRESSES;
  if (!raw) return recorded;

  let overrides: Record<string, unknown>;
  try {
    overrides = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("@alphamarkets/config: ALPHAMARKETS_ADDRESSES is not valid JSON");
  }

  const resolved = { ...recorded };
  for (const [key, value] of Object.entries(overrides)) {
    const known = key in recorded || (OPTIONAL_CONTRACTS as readonly string[]).includes(key);
    if (!known) throw new Error(`@alphamarkets/config: ALPHAMARKETS_ADDRESSES has unknown contract "${key}"`);
    if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new Error(`@alphamarkets/config: ALPHAMARKETS_ADDRESSES.${key} is not an address`);
    }
    resolved[key as keyof ContractAddresses] = value as Address;
  }
  return resolved;
}
