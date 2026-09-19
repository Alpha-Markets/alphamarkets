import type { ContractAddresses } from "@orionis/config";
import { fundingManagerAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { resolveMarketId } from "./utils.js";

export interface FundingInfo {
  currentFundingRateBps: bigint;
  fundingIntervalSeconds: bigint;
  nextFundingTimestamp: bigint;
}

export interface FundingNamespace {
  get(marketIdOrSymbol: string): Promise<FundingInfo>;
}

export function createFunding(client: OrionisClient, addresses: ContractAddresses): FundingNamespace {
  async function get(marketIdOrSymbol: string): Promise<FundingInfo> {
    const marketId = resolveMarketId(marketIdOrSymbol);
    const [currentFundingRateBps, fundingIntervalSeconds, nextFundingTimestamp] = await Promise.all([
      client.readContract({
        address: addresses.fundingManager,
        abi: fundingManagerAbi,
        functionName: "currentFundingRateBps",
        args: [marketId],
      }),
      client.readContract({
        address: addresses.fundingManager,
        abi: fundingManagerAbi,
        functionName: "fundingInterval",
        args: [marketId],
      }),
      client.readContract({
        address: addresses.fundingManager,
        abi: fundingManagerAbi,
        functionName: "nextFundingTimestamp",
        args: [marketId],
      }),
    ]);
    return { currentFundingRateBps, fundingIntervalSeconds, nextFundingTimestamp };
  }

  return { get };
}
