"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import type { EIP1193Provider } from "viem";
import type { Orionis } from "@orionis/sdk";
import { orionisWithWallet } from "@/lib/orionis";

/// The SDK client bound to the connected wallet, or `undefined` while disconnected or on the
/// wrong network. Reads use `orionisRead`; only actions that sign need this.
export function useWalletOrionis(): Orionis | undefined {
  const { address, connector, isConnected } = useAccount();
  const [client, setClient] = useState<Orionis>();

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address || !connector) {
      setClient(undefined);
      return;
    }
    void connector.getProvider().then((provider) => {
      if (!cancelled) setClient(orionisWithWallet(provider as EIP1193Provider, address));
    });
    return () => {
      cancelled = true;
    };
  }, [address, connector, isConnected]);

  return client;
}
