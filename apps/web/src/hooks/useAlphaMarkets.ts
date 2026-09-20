"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { EIP1193Provider } from "viem";
import type { AlphaMarkets } from "@alphamarkets/sdk";
import { alphaMarketsWithWallet } from "@/lib/alphamarkets";

/// The SDK client bound to the connected wallet, or `undefined` while disconnected or on the
/// wrong network. Reads use `alphaMarketsRead`; only actions that sign need this.
export function useWalletAlphaMarkets(): AlphaMarkets | undefined {
  const { address, connector, isConnected } = useAccount();
  const [client, setClient] = useState<AlphaMarkets>();

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address || !connector) {
      setClient(undefined);
      return;
    }
    void connector.getProvider().then((provider) => {
      if (!cancelled) setClient(alphaMarketsWithWallet(provider as EIP1193Provider, address));
    });
    return () => {
      cancelled = true;
    };
  }, [address, connector, isConnected]);

  return client;
}
