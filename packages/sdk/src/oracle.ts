import type { ContractAddresses } from "@alphamarkets/config";
import { oracleRouterAbi } from "./abis.js";
import type { AlphaMarketsClient } from "./client.js";
import { createApiGet } from "./api.js";
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

export type PriceRange = "1h" | "6h" | "24h" | "7d";

export interface PricePoint {
  /// Unix seconds.
  time: number;
  /// Index price, 18 decimals.
  price: bigint;
}

export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "1d";

/// One candlestick from the indexer's sampled index price. Prices are 18 decimals. `volume` is the
/// perp notional traded in the bucket, settlement-token base units. Display data only.
export interface Candle {
  /// Unix seconds, the start of the bucket.
  time: number;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  volume: bigint;
}

export interface PricesNamespace {
  /// Candlesticks (open, high, low, close, perp volume) from the indexer's price samples, oldest
  /// first. A bucket with no price sample is absent, so a quiet indexer leaves gaps. Requires
  /// `apiUrl`.
  candles(marketIdOrSymbol: string, interval?: CandleInterval, limit?: number): Promise<Candle[]>;
  /// Index-price history sampled by the indexer, for charts. Requires `apiUrl`. Display only.
  history(marketIdOrSymbol: string, range?: PriceRange): Promise<PricePoint[]>;
  /// Index, Mark and Last price, read from OracleRouter.
  get(marketIdOrSymbol: string): Promise<PriceSet>;
  /// Validated expiry price used for options settlement (reverts until recorded for `expiry`).
  settlement(marketIdOrSymbol: string, expiry: bigint | Date | string): Promise<PriceReading>;
}

export function createPrices(
  client: AlphaMarketsClient,
  addresses: ContractAddresses,
  oracle: OracleNamespace,
  apiUrl?: string,
): PricesNamespace {
  const apiGet = createApiGet(apiUrl);

  async function get(marketIdOrSymbol: string): Promise<PriceSet> {
    const marketId = resolveMarketId(marketIdOrSymbol);
    // One `multicall` instead of three separate `readContract` calls — a rate-limited RPC
    // provider counts each request, and this runs on every price tick for every visible market.
    const [index, mark, last] = await client.multicall({
      contracts: (["getIndexPrice", "getMarkPrice", "getLastPrice"] as const).map((functionName) => ({
        address: addresses.oracleRouter,
        abi: oracleRouterAbi,
        functionName,
        args: [marketId],
      })),
      allowFailure: false,
    });
    return {
      index: { price: index[0], timestamp: index[1] },
      mark: { price: mark[0], timestamp: mark[1] },
      last: { price: last[0], timestamp: last[1] },
    };
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

  async function history(marketIdOrSymbol: string, range: PriceRange = "24h"): Promise<PricePoint[]> {
    const rows = await apiGet<Array<{ time: number; price: string }>>(
      "prices.history",
      `/v1/prices/${marketIdOrSymbol}/history?range=${range}`,
    );
    return rows.map((row) => ({ time: row.time, price: BigInt(row.price) }));
  }

  async function candles(marketIdOrSymbol: string, interval: CandleInterval = "5m", limit = 120): Promise<Candle[]> {
    const rows = await apiGet<Array<{ time: number; open: string; high: string; low: string; close: string; volume: string }>>(
      "prices.candles",
      `/v1/prices/${marketIdOrSymbol}/candles?interval=${interval}&limit=${limit}`,
    );
    return rows.map((row) => ({
      time: row.time,
      open: BigInt(row.open),
      high: BigInt(row.high),
      low: BigInt(row.low),
      close: BigInt(row.close),
      volume: BigInt(row.volume),
    }));
  }

  return { get, settlement, history, candles };
}

export function createOracle(client: AlphaMarketsClient, addresses: ContractAddresses): OracleNamespace {
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
