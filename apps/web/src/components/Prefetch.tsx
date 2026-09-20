"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { allMarketsQuery, marketStatsQuery, overviewQuery, perpMarketQuery, perpMarketsQuery, priceHistoryQuery } from "@/hooks/queries";
import { env } from "@/lib/env";
import { symbolOf } from "@/lib/market";

/// Markets warmed beyond the first, so a long registry cannot turn the warm-up into a burst of reads.
const MAX_MARKETS = 12;

/// Loads the data every public page starts from (the market list, statistics, and each market's
/// prices, funding, open interest and 24h history) while the visitor is still on the landing page,
/// so the first visit to Markets, Perpetuals or Options finds it in the cache instead of waiting on
/// a chain of round trips. It renders nothing, changes no query key, and a failed read is ignored:
/// the page asks again with its own loading state.
export function Prefetch() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!env.rpcConfigured) return;
    let cancelled = false;

    const warm = async () => {
      const [markets] = await Promise.all([
        queryClient.fetchQuery(allMarketsQuery()).catch(() => undefined),
        queryClient.prefetchQuery(perpMarketsQuery()),
        queryClient.prefetchQuery(marketStatsQuery()),
      ]);
      if (cancelled || !markets) return;
      const symbols = markets
        .filter((market) => market.active)
        .slice(0, MAX_MARKETS)
        .map((market) => symbolOf(market.marketId));
      for (const symbol of symbols) {
        void queryClient.prefetchQuery(overviewQuery(symbol));
        void queryClient.prefetchQuery(priceHistoryQuery(symbol, "24h"));
      }
      if (symbols[0]) void queryClient.prefetchQuery(perpMarketQuery(symbols[0]));
    };

    // After first paint, so the warm-up never competes with the page the visitor is looking at.
    const handle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(() => void warm()) : window.setTimeout(() => void warm(), 300);
    return () => {
      cancelled = true;
      if (typeof window.cancelIdleCallback === "function" && typeof handle === "number") window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [queryClient]);

  return null;
}
