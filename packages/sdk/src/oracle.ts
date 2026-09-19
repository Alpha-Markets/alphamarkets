import type { ContractAddresses } from "@orionis/config";
import { oracleRouterAbi } from "./abis.js";
import type { OrionisClient } from "./client.js";
import { toUnixSeconds, resolveMarketId } from "./utils.js";

export interface PriceReading {
  price: bigint;
  timestamp: bigint;
}

/// PROJECT_BRIEF.md Section 17's three onchain price types (Settlement Price is read via
/// `options.settleExpired`'s own path, not exposed as a separate live read here).
export interface OracleNamespace {
  getIndexPrice(marketIdOrSymbol: string): Promise<PriceReading>;
  getMarkPrice(marketIdOrSymbol: string): Promise<PriceReading>;
  getLastPrice(marketIdOrSymbol: string): Promise<PriceReading>;
}

/// All four PROJECT_BRIEF.md Section 17 price types for one market. `settlement` is only
/// present when an expiry was requested.
export interface PriceSet {
  index: PriceReading;
  mark: PriceReading;
  last: PriceReading;
}

export interface PricesNamespace {
  /// Index, Mark and Last price, read from OracleRouter.
  get(marketIdOrSymbol: string): Promise<PriceSet>;
  /// Validated expiry price used for options settlement (reverts until recorded for `expiry`).
  settlement(marketIdOrSymbol: string, expiry: bigint | Date | string): Promise<PriceReading>;
}

export function createPrices(client: OrionisClient, addresses: ContractAddresses, oracle: OracleNamespace): PricesNamespace {
  async function get(marketIdOrSymbol: string): Promise<PriceSet> {
    const [index, mark, last] = await Promise.all([
      oracle.getIndexPrice(marketIdOrSymbol),
      oracle.getMarkPrice(marketIdOrSymbol),
      oracle.getLastPrice(marketIdOrSymbol),
    ]);
    return { index, mark, last };
  }

  async function settlement(marketIdOrSymbol: string, expiry: bigint | Date | string): Promise<PriceReading> {
    const [price, timestamp] = await client.readContract({
      address: addresses.oracleRouter,
      abi: oracleRouterAbi,
      functionName: "getSettlementPrice",
      args: [resolveMarketId(marketIdOrSymbol), toUnixSeconds(expiry)],
    });
    return { price, timestamp };
  }

  return { get, settlement };
}

export function createOracle(client: OrionisClient, addresses: ContractAddresses): OracleNamespace {
  function reading(functionName: "getIndexPrice" | "getMarkPrice" | "getLastPrice") {
    return async (marketIdOrSymbol: string): Promise<PriceReading> => {
      const [price, timestamp] = await client.readContract({
        address: addresses.oracleRouter,
        abi: oracleRouterAbi,
        functionName,
        args: [resolveMarketId(marketIdOrSymbol)],
      });
      return { price, timestamp };
    };
  }

  return {
    getIndexPrice: reading("getIndexPrice"),
    getMarkPrice: reading("getMarkPrice"),
    getLastPrice: reading("getLastPrice"),
  };
}
