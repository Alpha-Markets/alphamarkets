import type { ContractAddresses } from "@orionis/config";
import type { MarketConfig } from "@orionis/types";
import { marketRegistryAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { createApiGet } from "./api.js";
import { resolveMarketId } from "./utils.js";

/// Per-market statistics derived from the indexer (PROJECT_BRIEF.md Section 29). Volumes are
/// settlement-token base units. These are display figures; nothing onchain reads them.
export interface MarketStats {
  marketId: `0x${string}`;
  /// Index price change in basis points, or null until the indexer has sampled a price.
  change24hBps: number | null;
  /// How much history the change actually covers: 86400 for a true 24h figure, less while the
  /// indexer has been sampling for a shorter time.
  changeWindowSeconds: number;
  perpVolume24h: bigint;
  /// Premium paid on options opened in the last 24h.
  optionsVolume24h: bigint;
}

export interface MarketsNamespace {
  /// 24h change and volumes per market, from `services/indexer` via the API. Requires `apiUrl`.
  stats(): Promise<MarketStats[]>;
  /// Reads every market from MarketRegistry — the single source of truth
  /// (PROJECT_BRIEF.md Section 18); never a separate hardcoded list.
  list(): Promise<MarketConfig[]>;
  get(marketIdOrSymbol: string): Promise<MarketConfig>;
}

export function createMarkets(client: OrionisClient, addresses: ContractAddresses, apiUrl?: string): MarketsNamespace {
  const apiGet = createApiGet(apiUrl);

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

  async function stats(): Promise<MarketStats[]> {
    const rows = await apiGet<
      Array<{ marketId: `0x${string}`; change24hBps: number | null; changeWindowSeconds: number; perpVolume24h: string; optionsVolume24h: string }>
    >("markets.stats", "/v1/markets/stats");
    return rows.map((row) => ({
      ...row,
      perpVolume24h: BigInt(row.perpVolume24h),
      optionsVolume24h: BigInt(row.optionsVolume24h),
    }));
  }

  return { list, get, stats };
}
