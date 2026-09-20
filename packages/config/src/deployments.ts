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
/// from the recorded literal below until a deployment includes them, but `ORIONIS_ADDRESSES` may
/// still supply them (a local or fresh deployment).
export const OPTIONAL_CONTRACTS = ["perpOrderManager", "insuranceFund", "crossMargin", "subaccountFactory", "rfqManager"] as const satisfies ReadonlyArray<keyof ContractAddresses>;

/// Mirrors `packages/contracts/deployments/robinhood_testnet.json`. Kept as a checked-in
/// literal rather than read from disk at build time — there is no deploy-to-config sync step
/// yet, so this must be updated by hand whenever that file changes (see CHANGELOG entry for
/// the deploy that produced it).
const robinhoodTestnetAddresses: ContractAddresses = {
  marketRegistry: "0xD1019516182cCC5976884b31e39E63247d5bdA3b",
  oracleRouter: "0x690b3039266535bEe12ec63247eCB75A056bb453",
  vault: "0x2C4751299bf5c3B659da825ce9Ba610D30509d19",
  collateralManager: "0x3CF01Ed4C450aec514Ed3cFEBF38fCCC8bb9a360",
  feeManager: "0xF0B42B2d5eBF0f4b8ae195eb230Aee164914F710",
  buybackModule: "0x1EDF2A8eb01ae0199A605B23482E3266C5BAdeeC",
  riskManager: "0xB0D49b787dABa84b1Bc87EF6735a006Dd90dfca2",
  optionsEngine: "0x28CEF869Bc5736C815d3c1304A7b53c064e35D32",
  optionMarket: "0x72a716E0995324A94723fccf98b315b0421C19c8",
  optionPositionManager: "0x544624e7dB172C1b614952eA6D7A51597Ac53677",
  perpsEngine: "0x0f47b9CC8de372D02c7664a931CFBFdbbB505446",
  perpPositionManager: "0xB2fa58A93b05b1Cc2773D795976EFc08BF3aF246",
  liquidationEngine: "0x17c47aB434ef561348eC70A0927703d838Fe8d70",
  fundingManager: "0x181D8e405560b16F8d42a9Ba941CC3a8513F1676",
  priceValidator: "0x3b0Fe50B4FA6A6144F320f34acf7ff29307eFf79",
  settlementToken: "0x70b0FDa35dEb7BA710C601Ed9c45b9F992027112",
  perpOrderManager: "0x3a7E7f9da5758fd9519e13fdeB3A77891b1B51e7",
  insuranceFund: "0x8B46113C13ecCd7e1D01c0fEf18d4241740d2212",
  crossMargin: "0x82e464Da82Ab1447637dE8Fe9faF490A978019c0",
  subaccountFactory: "0xA0068d8E945bBD3b23aB029E17e4B1C749E40062",
  rfqManager: "0xB314f10cA6C71F723c08EAa545688dF9EBe53F94",
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
