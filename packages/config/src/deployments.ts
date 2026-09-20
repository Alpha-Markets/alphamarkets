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
  marketRegistry: "0x9BC1F3927EF19E5CE75Ce964ddf1ECCBfbc75860",
  oracleRouter: "0x92e506941Fa70821888bB0A06FD9B9DFF39DaC4a",
  vault: "0x2EFE37890e3Dce8a18B75fFBE17b941952B25245",
  collateralManager: "0x4cB54d06104BF249c158704Dd55C51E859091238",
  feeManager: "0xD931b01626Ca93ceB9DF00f5AdD87cBcC7960709",
  buybackModule: "0x88c404731358C75d7286a450850a0AaB8133462d",
  riskManager: "0xA6f31aDaF3d685a9b0079e22454ED69B0A812F6D",
  optionsEngine: "0x2d02597B4576b4804600C08519351792D376644e",
  optionMarket: "0xc03122Df09F563C215A9dF5da0b75ab822f0115E",
  optionPositionManager: "0x71DFEd832a096C51B72247F567e0de1c1AC141D1",
  perpsEngine: "0xD0540f9dCf8667e60397813F56B49484D55A8bDc",
  perpPositionManager: "0x4A91677FD35A84085215f8f77c5894cA3Ee2f676",
  liquidationEngine: "0x335D0404e9Bc88E8f8d37A68EB9267EbDfFC31cD",
  fundingManager: "0x6c0b6f70bD03953AfA4486fe0285f93656620B52",
  priceValidator: "0x8202ECC35c540158ebbb9bA3228EE194Cb5E83c4",
  settlementToken: "0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112",
  perpOrderManager: "0xc79062530aBE30aD38AD8862005523739a3f4e21",
  insuranceFund: "0xEA90ea0A4a8E3F08DafF44D89d2C94feaA21a8b1",
  crossMargin: "0x423f332c325f0D12F8C584E230597f6a6fEa4A23",
  subaccountFactory: "0xe3DB5f7a3C11336c212D699C6D593fFE2E65BD01",
  rfqManager: "0x7CF3F244eC6819321980146dA906f51eE7a4F1f1",
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
