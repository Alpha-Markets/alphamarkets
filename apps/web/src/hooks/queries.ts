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
