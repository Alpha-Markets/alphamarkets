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
  marketRegistry: "0x15F599aFBCE042922716ae2C169e5dB9Be6eA855",
  oracleRouter: "0xCB9AD3D302C49696FBc322742355a84f49D618cd",
  vault: "0x5c809C4872c603fBF74f48Fdc8348EaDEC5dFF66",
  collateralManager: "0x3bd150A6c70aa668cB6052DD6c4cb44938B1557D",
  feeManager: "0x15C6b95c289bd093b05B7578257aDfE4CADe8EDF",
  buybackModule: "0x829447D77f25578706d7C84c2756bc793094fCda",
  riskManager: "0x7cBE5EcFC9a57022e6Ee397627D6b4B354c9Eb2D",
  optionsEngine: "0x8c7F0f7e196d9C841b3BE2CDf0Ad52D4F2a00cd5",
  optionMarket: "0xcf418529fA0B64ce8359E1C3abb33c8c216C5954",
  optionPositionManager: "0x0f612910002A6dc4A2087A2dD3f851d4D850C017",
  perpsEngine: "0x901bA7223B4298ddB0CF4528200792d4F679580F",
  perpPositionManager: "0xC3D98bACc4c6Ba46D16229fb8AD117e0dFC643d6",
  liquidationEngine: "0xd03C8E323c63B13213c78408D3f55c4A1b2e6C9B",
  fundingManager: "0x850F32d7c7F29F913C26556d46820f0D2108428d",
  priceValidator: "0xe4b6E3e7e92F4877F725283D5D3a719f99B0392B",
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
