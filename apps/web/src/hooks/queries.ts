"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Address } from "@orionis/types";
import { orionisRead } from "@/lib/orionis";
import { env } from "@/lib/env";

const TICK_MS = 4_000;

export function usePerpMarkets() {
  return useQuery({ queryKey: ["perp-markets"], queryFn: () => orionisRead.perps.list(), refetchInterval: 30_000 });
}

/// Config, risk parameters, funding and the three live prices for one market.
export function usePerpMarket(symbol: string) {
  return useQuery({
    queryKey: ["perp-market", symbol],
    queryFn: () => orionisRead.perps.get(symbol),
    enabled: Boolean(symbol),
    refetchInterval: TICK_MS,
  });
}

export function useSettlementDecimals() {
  return useQuery({
    queryKey: ["settlement-decimals"],
    queryFn: () => orionisRead.erc20.decimals(env.addresses.settlementToken),
    staleTime: Infinity,
  });
}

export function useVaultBalances() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["vault-balances", address],
    queryFn: () => orionisRead.vault.balances(address as Address, env.addresses.settlementToken),
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
}

export function useWalletTokenBalance() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["wallet-token-balance", address],
    queryFn: () => orionisRead.erc20.balanceOf(env.addresses.settlementToken, address as Address),
    enabled: Boolean(address),
    refetchInterval: 8_000,
  });
}

export function usePositions() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["positions", address],
    queryFn: () => orionisRead.portfolio.positions(address as Address),
    enabled: Boolean(address),
    refetchInterval: 6_000,
  });
}

/// Every market on the registry, perps and options alike.
export function useAllMarkets() {
  return useQuery({ queryKey: ["all-markets"], queryFn: () => orionisRead.markets.list(), refetchInterval: 30_000 });
}

/// Statistics need `services/api`; without it the query is off and pages show "–".
export function useMarketStats() {
  return useQuery({
    queryKey: ["market-stats"],
    queryFn: () => orionisRead.markets.stats(),
    enabled: Boolean(env.apiUrl),
    refetchInterval: 60_000,
    retry: false,
  });
}

/// What the Markets page needs per row from the chain. Each read is settled separately so one
/// market with, say, no funding configured still shows its price.
export function useMarketOverview(symbol: string) {
  return useQuery({
    queryKey: ["market-overview", symbol],
    queryFn: async () => {
      const [prices, funding, openInterest] = await Promise.allSettled([
        orionisRead.prices.get(symbol),
        orionisRead.funding.get(symbol),
        orionisRead.risk.openInterest(symbol),
      ]);
      const value = <T,>(result: PromiseSettledResult<T>) => (result.status === "fulfilled" ? result.value : undefined);
      return { prices: value(prices), funding: value(funding), openInterest: value(openInterest) };
    },
    refetchInterval: TICK_MS,
  });
}

export function usePortfolioSummary() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["portfolio-summary", address],
    queryFn: () => orionisRead.portfolio.summary(address as Address),
    enabled: Boolean(address),
    refetchInterval: 6_000,
  });
}

export function useFunding() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["funding", address],
    queryFn: () => orionisRead.portfolio.funding(address as Address, { limit: 200 }),
    enabled: Boolean(address && env.apiUrl),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useHistory() {
  const { address } = useAccount();
  return useQuery({
    queryKey: ["history", address],
    queryFn: () => orionisRead.portfolio.history(address as Address, { limit: 200 }),
    enabled: Boolean(address && env.apiUrl),
    refetchInterval: 30_000,
    retry: false,
  });
}

export function usePriceHistory(symbol: string, range: "1h" | "6h" | "24h" | "7d") {
  return useQuery({
    queryKey: ["price-history", symbol, range],
    queryFn: () => orionisRead.prices.history(symbol, range),
    enabled: Boolean(symbol && env.apiUrl),
    refetchInterval: 60_000,
    retry: false,
  });
}
