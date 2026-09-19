import type { ContractAddresses } from "@orionis/config";
import { feeManagerAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { resolveMarketId } from "./utils.js";

/// Mirrors `FeeConfig` in DataTypes.sol (PROJECT_BRIEF.md Section 20). All values are basis
/// points. Fee percentages are read from FeeManager, never hardcoded in any client.
export interface FeeInfo {
  makerFee: bigint;
  takerFee: bigint;
  optionOpenFee: bigint;
  optionCloseFee: bigint;
  settlementFee: bigint;
  liquidationFee: bigint;
}

export interface FeesNamespace {
  get(marketIdOrSymbol: string): Promise<FeeInfo>;
}

export function createFees(client: OrionisClient, addresses: ContractAddresses): FeesNamespace {
  async function get(marketIdOrSymbol: string): Promise<FeeInfo> {
    const config = await client.readContract({
      address: addresses.feeManager,
      abi: feeManagerAbi,
      functionName: "getFeeConfig",
      args: [resolveMarketId(marketIdOrSymbol)],
    });
    return { ...config };
  }

  return { get };
}
