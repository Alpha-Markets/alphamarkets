import type { ContractAddresses } from "@alphamarkets/config";
import { fundingManagerAbi } from "./abis.js";
import type { AlphaMarketsClient } from "./client.js";
import { createApiGet } from "./api.js";
import { resolveMarketId } from "./utils.js";

export interface FundingInfo {
  currentFundingRateBps: bigint;
  fundingIntervalSeconds: bigint;
  nextFundingTimestamp: bigint;
}

/// The funding rate the chain applied at one interval. Positive means longs paid shorts.
export interface FundingRatePoint {
  /// Unix seconds (when the indexer recorded it).
  time: number;
  rateBps: bigint;
  cumulativeIndex: bigint;
  txHash: string;
}

export interface FundingNamespace {
  get(marketIdOrSymbol: string): Promise<FundingInfo>;
  /// Funding rates the chain applied to a market, oldest first, from `services/indexer`. Requires
  /// `apiUrl`. Display data.
  history(marketIdOrSymbol: string, limit?: number): Promise<FundingRatePoint[]>;
}

export function createFunding(client: AlphaMarketsClient, addresses: ContractAddresses, apiUrl?: string): FundingNamespace {
  const apiGet = createApiGet(apiUrl);

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

  async function history(marketIdOrSymbol: string, limit = 100): Promise<FundingRatePoint[]> {
    const rows = await apiGet<Array<{ time: number; rateBps: string; cumulativeIndex: string; txHash: string }>>(
      "funding.history",
      `/v1/perps/${marketIdOrSymbol}/funding/history?limit=${limit}`,
    );
    return rows.map((row) => ({ time: row.time, rateBps: BigInt(row.rateBps), cumulativeIndex: BigInt(row.cumulativeIndex), txHash: row.txHash }));
  }

  return { get, history };
}
