import type { ContractAddresses } from "@orionis/config";
import type { MarketConfig } from "@orionis/types";
import { marketRegistryAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { resolveMarketId } from "./utils.js";

export interface MarketsNamespace {
  /// Reads every market from MarketRegistry — the single source of truth
  /// (PROJECT_BRIEF.md Section 18); never a separate hardcoded list.
  list(): Promise<MarketConfig[]>;
  get(marketIdOrSymbol: string): Promise<MarketConfig>;
}

export function createMarkets(client: OrionisClient, addresses: ContractAddresses): MarketsNamespace {
  async function get(marketIdOrSymbol: string): Promise<MarketConfig> {
    const marketId = resolveMarketId(marketIdOrSymbol);
    const config = await client.readContract({
      address: addresses.marketRegistry,
      abi: marketRegistryAbi,
      functionName: "getMarket",
      args: [marketId],
    });
    return config as MarketConfig;
  }

  async function list(): Promise<MarketConfig[]> {
    const marketIds = await client.readContract({
      address: addresses.marketRegistry,
      abi: marketRegistryAbi,
      functionName: "allMarketIds",
    });
    return Promise.all(marketIds.map((marketId) => get(marketId)));
  }

  return { list, get };
}
