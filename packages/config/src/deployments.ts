import type { Address } from "@alphamarkets/types";
import { ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, type ChainId } from "./chains.js";

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

/// Mirrors `packages/contracts/deployments/robinhood_mainnet.json` (DeployAll, 2026-09-25). The
/// stack is deployed but empty: no markets, feeds or funds, and the deployer wallet still holds
/// every admin role. Not open for real funds until docs/MAINNET_READINESS.md is closed.
const robinhoodMainnetAddresses: ContractAddresses = {
  marketRegistry: "0x71Bb058106b1a226a6f66e2152719a6B827c783a",
  oracleRouter: "0x831255818E492f31a5515b0b62a1406F00c7BA7c",
  vault: "0x9aC6782D82D980f2623bBE78C8882832baC94903",
  collateralManager: "0x5Dd7bf74253D392C6D071D00e873F6660edb6D78",
  feeManager: "0xa8D4641d988411fa4F312ac942da1e063C19cB47",
  buybackModule: "0xEE8AE4155C653B664727CA5EF0757914aA4769CE",
  riskManager: "0xCe8d2D037f32B61E4a3023bAB62Fb125A9b97f07",
  optionsEngine: "0xFa58B6B1D9B9de3A841B463ed1e945f8422932aD",
  optionMarket: "0x71C64D56ae35a85E18E24A53264E73f4d058338C",
  optionPositionManager: "0xdfE7AaDBA3574760Be45d0B3D3Ce09507361fa78",
  perpsEngine: "0xf7Ce817965156A308b0Cdf1FED554e35055f3190",
  perpPositionManager: "0x3eA78624f5F9a514FA69427a691c62418f4C9493",
  liquidationEngine: "0x0979B96607C44435BC5462A738a7F10D55a4142C",
  fundingManager: "0xe9DFC7B3e2179A826095b87E24e657d6e6e45bB0",
  priceValidator: "0x8eBEB401A0a4f676B63dcC687Cf300B81f239ba6",
  settlementToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  perpOrderManager: "0x170ed757E332547d27b7ca0644Fee22259A25279",
  insuranceFund: "0xE10833Aa9C438e84626e1D73B4ec5319B5ebc263",
  crossMargin: "0xea3Ce04FA538FE6C0AEd377Cd0Cc86FE4CD0A28F",
  subaccountFactory: "0x7bd8f7D7E615A692821d6A31275dB38BC6836980",
  rfqManager: "0xE4B6aA5FdC12491e89D999FDe17e69340e19344C",
};

export const deployments: Record<ChainId, ContractAddresses> = {
  [ROBINHOOD_TESTNET_CHAIN_ID]: robinhoodTestnetAddresses,
  [ROBINHOOD_MAINNET_CHAIN_ID]: robinhoodMainnetAddresses,
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

/// The protocol token of a chain, when one exists. It is not a contract of this stack: `BuybackModule`
/// takes it through `setProtocolToken`, and nothing here reads it on chain. The mainnet token was created
/// outside this repository (name "Alpha Markets", 18 decimals, 1,000,000,000 supply, checked on chain on
/// 2026-09-25), so it is recorded here as a display fact, not a deployment. A web build may override both
/// values with `NEXT_PUBLIC_PROTOCOL_TOKEN_ADDRESS` and `NEXT_PUBLIC_PROTOCOL_TOKEN_SYMBOL`.
export const protocolTokens: Partial<Record<ChainId, { address: Address; symbol: string }>> = {
  [ROBINHOOD_MAINNET_CHAIN_ID]: { address: "0xaf9eb3274b41e372c58b39fabd01e1d1eebc3579", symbol: "ALPHA" },
};
