"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { CandleInterval, OpenInterestRange } from "@alphamarkets/sdk";
import type { Address } from "@alphamarkets/types";
import { alphaMarketsRead } from "@/lib/alphamarkets";
import { env } from "@/lib/env";
import { readHistoryAfter } from "@/lib/history";
import { seriesKey } from "@/lib/options";

// Fans out per market (overviewQuery, listedExpiriesQuery) across every mounted component — a
// rate-limited/free-tier RPC provider hits 429s well before this many requests a second, so this
// stays conservative rather than "as live as possible".
const TICK_MS = 15_000;

// Query definitions are exported next to their hooks so `Prefetch` can warm the same cache entries
// (same key, same function) before a page asks for them.
export const perpMarketsQuery = () => ({ queryKey: ["perp-markets"], queryFn: () => alphaMarketsRead.perps.list(), refetchInterval: 30_000 });

export function usePerpMarkets() {
  return useQuery(perpMarketsQuery());
}

/// Config, risk parameters, funding and the three live prices for one market.
export const perpMarketQuery = (symbol: string) => ({
  queryKey: ["perp-market", symbol],
  queryFn: () => alphaMarketsRead.perps.get(symbol),
  enabled: Boolean(symbol),
  refetchInterval: TICK_MS,
});

export function usePerpMarket(symbol: string) {
  return useQuery(perpMarketQuery(symbol));
}

export function useSettlementDecimals() {
  return useQuery({
    queryKey: ["settlement-decimals"],
    queryFn: () => alphaMarketsRead.erc20.decimals(env.addresses.settlementToken),
    staleTime: Infinity,
  });
}

export function useVaultBalances() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["vault-balances", address],
    queryFn: () => alphaMarketsRead.vault.balances(address as Address, env.addresses.settlementToken),
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
}

export function useWalletTokenBalance() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["wallet-token-balance", address],
    queryFn: () => alphaMarketsRead.erc20.balanceOf(env.addresses.settlementToken, address as Address),
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
}

export function usePositions() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["positions", address],
    queryFn: () => alphaMarketsRead.portfolio.positions(address as Address),
    enabled: Boolean(address),
    refetchInterval: 6_000,
  });
}

/// Every market on the registry, perps and options alike.
export const allMarketsQuery = () => ({ queryKey: ["all-markets"], queryFn: () => alphaMarketsRead.markets.list(), refetchInterval: 30_000 });

export function useAllMarkets() {
  return useQuery(allMarketsQuery());
}

/// Statistics need `services/api`; without it the query is off and pages show "–".
export const marketStatsQuery = () => ({
  queryKey: ["market-stats"],
  queryFn: () => alphaMarketsRead.markets.stats(),
  enabled: Boolean(env.apiUrl),
  refetchInterval: 60_000,
  retry: false,
});

export function useMarketStats() {
  return useQuery(marketStatsQuery());
}

/// What the Markets page needs per market from the chain. Each read is settled separately so one
/// market with, say, no funding configured still shows its price.
async function fetchMarketOverview(symbol: string) {
  const [prices, funding, openInterest] = await Promise.allSettled([
    alphaMarketsRead.prices.get(symbol),
    alphaMarketsRead.funding.get(symbol),
    alphaMarketsRead.risk.openInterest(symbol),
  ]);
  const value = <T,>(result: PromiseSettledResult<T>) => (result.status === "fulfilled" ? result.value : undefined);
  return { prices: value(prices), funding: value(funding), openInterest: value(openInterest) };
}

export const overviewQuery = (symbol: string) => ({
  queryKey: ["market-overview", symbol],
  queryFn: () => fetchMarketOverview(symbol),
  refetchInterval: TICK_MS,
});

/// The overview for several markets at once, in the order given, so a table can sort by it. Each
/// entry is `overviewQuery(symbol)`, so the cache is shared with anything else that reads it.
export function useMarketOverviews(symbols: string[]) {
  return useQueries({ queries: symbols.map(overviewQuery) });
}

export function usePortfolioSummary() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["portfolio-summary", address],
    queryFn: () => alphaMarketsRead.portfolio.summary(address as Address),
    enabled: Boolean(address),
    refetchInterval: 6_000,
  });
}

export function useFunding() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["funding", address],
    queryFn: () => alphaMarketsRead.portfolio.funding(address as Address, { limit: 200 }),
    enabled: Boolean(address && env.apiUrl),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useHistory() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["history", address],
    queryFn: () => readHistoryAfter(address as Address),
    enabled: Boolean(address && env.apiUrl),
    refetchInterval: 30_000,
    retry: false,
  });
}

export const priceHistoryQuery = (symbol: string, range: "1h" | "6h" | "24h" | "7d") => ({
  queryKey: ["price-history", symbol, range],
  queryFn: () => alphaMarketsRead.prices.history(symbol, range),
  enabled: Boolean(symbol && env.apiUrl),
  refetchInterval: 60_000,
  retry: false,
});

export function usePriceHistory(symbol: string, range: "1h" | "6h" | "24h" | "7d") {
  return useQuery(priceHistoryQuery(symbol, range));
}

/// Markets the registry allows options on. The underlying selector on the Options page reads this.
export function useOptionUnderlyings() {
  return useQuery({
    queryKey: ["option-underlyings"],
    queryFn: async () => (await alphaMarketsRead.markets.list()).filter((market) => market.optionsEnabled && market.active),
    refetchInterval: 30_000,
  });
}

/// Index price, the spot the strike ladder is centred on.
export function useIndexPrice(symbol: string) {
  return useQuery({
    queryKey: ["index-price", symbol],
    queryFn: async () => (await alphaMarketsRead.prices.get(symbol)).index.price,
    enabled: Boolean(symbol),
    refetchInterval: TICK_MS,
  });
}

/// Expiries that already have an opened series, from the indexer. Off without `NEXT_PUBLIC_API_URL`.
export function useListedExpiries(symbol: string) {
  return useQuery({
    queryKey: ["option-expiries", symbol],
    queryFn: () => alphaMarketsRead.options.expiries(symbol),
    enabled: Boolean(symbol && env.apiUrl),
    refetchInterval: 60_000,
    retry: false,
  });
}

/// One display-only quote (premium, IV, Greeks) per strike and side for one expiry. These are
/// unsigned analytics from the pricing service, never the price an order is charged. The order
/// ticket asks for a signed quote separately.
export function useOptionChain(symbol: string, expiry: bigint | undefined, strikes: bigint[]) {
  const sides = ["CALL", "PUT"] as const;
  const results = useQueries({
    queries: strikes.flatMap((strike) =>
      sides.map((type) => ({
        queryKey: ["option-chain-quote", symbol, String(expiry), strike.toString(), type],
        queryFn: () => alphaMarketsRead.options.quote({ underlying: symbol, type, strike, expiry: expiry!, contracts: 1 }),
        enabled: Boolean(env.apiUrl && symbol && expiry),
        refetchInterval: 15_000,
        retry: false,
      })),
    ),
  });
  return strikes.map((strike, index) => ({ strike, call: results[index * 2]!, put: results[index * 2 + 1]! }));
}

/// Open interest and 24h volume per option series for one expiry, keyed by `seriesKey`. A series
/// nobody has traded is absent, which the chain shows as zero.
export function useOptionStats(symbol: string, expiry: bigint | undefined) {
  return useQuery({
    queryKey: ["option-stats", symbol, String(expiry)],
    queryFn: async () => {
      const rows = await alphaMarketsRead.options.stats(symbol, expiry);
      return new Map(rows.map((row) => [seriesKey(row.strike, row.type), row]));
    },
    enabled: Boolean(env.apiUrl && symbol && expiry),
    refetchInterval: 30_000,
    retry: false,
  });
}

/// The most candles the API returns. The chart opens on the newest ones; the rest is one zoom-out away.
const CANDLE_LIMIT = 500;

export function useCandles(symbol: string, interval: CandleInterval) {
  return useQuery({
    queryKey: ["candles", symbol, interval],
    queryFn: () => alphaMarketsRead.prices.candles(symbol, interval, CANDLE_LIMIT),
    enabled: Boolean(symbol && env.apiUrl),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useMarketFundingHistory(symbol: string) {
  return useQuery({
    queryKey: ["market-funding-history", symbol],
    queryFn: () => alphaMarketsRead.funding.history(symbol, 100),
    enabled: Boolean(symbol && env.apiUrl),
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useOpenInterestHistory(symbol: string, range: OpenInterestRange) {
  return useQuery({
    queryKey: ["open-interest-history", symbol, range],
    queryFn: () => alphaMarketsRead.risk.openInterestHistory(symbol, range),
    enabled: Boolean(symbol && env.apiUrl),
    refetchInterval: 60_000,
    retry: false,
  });
}

/// Open interest now and the cap RiskManager enforces, both read from the chain.
export function useOpenInterestNow(symbol: string) {
  return useQuery({
    queryKey: ["open-interest-now", symbol],
    queryFn: async () => {
      const [openInterest, risk] = await Promise.all([alphaMarketsRead.risk.openInterest(symbol), alphaMarketsRead.risk.get(symbol)]);
      return { ...openInterest, cap: risk.openInterestCap };
    },
    enabled: Boolean(symbol),
    refetchInterval: 15_000,
  });
}

/// The connected wallet's limit orders, oldest first, read from the chain. Off on a deployment
/// without limit orders.
export function useOrders() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["orders", address],
    queryFn: () => alphaMarketsRead.portfolio.orders(address as Address),
    enabled: Boolean(address && env.limitOrders),
    refetchInterval: 8_000,
  });
}

/// Whether the deployment has stop-loss and take-profit orders. A deployment made before `[1.3.0]`
/// has limit orders without them. Cached for the session once known.
export function useTriggerSupport() {
  return useQuery({
    queryKey: ["trigger-support"],
    queryFn: () => alphaMarketsRead.perps.supportsTriggerOrders(),
    enabled: env.limitOrders,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/// The connected wallet's stop-loss and take-profit orders, oldest first, read from the chain.
/// Off where the deployment has none.
export function useTriggerOrders() {
  const { address } = useAccount();
  const { data: supported } = useTriggerSupport();
  return useQuery({
    queryKey: ["trigger-orders", address],
    queryFn: () => alphaMarketsRead.portfolio.triggerOrders(address as Address),
    enabled: Boolean(address && supported),
    refetchInterval: 8_000,
  });
}

/// Ids of the connected wallet's cross-margin positions, as strings. Off where the deployment has no
/// cross margin. A cross position is liquidated on the account's health, so its own liquidation price
/// would mislead.
export function useCrossPositions() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["cross-positions", address],
    queryFn: async () => new Set((await alphaMarketsRead.crossMargin.positions(address as Address)).map((id) => id.toString())),
    enabled: Boolean(address && env.crossMargin),
    refetchInterval: 15_000,
  });
}
