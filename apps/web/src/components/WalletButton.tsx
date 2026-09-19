"use client";

import { Button } from "@orionis/ui";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/wagmi";
import { shortHash } from "@/lib/format";

/// Connect, switch network, or disconnect — whichever the wallet needs next.
export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected || !address) {
    const connector = connectors[0];
    return (
      <Button variant="primary" size="sm" disabled={!connector || isPending} onClick={() => connector && connect({ connector })}>
        {isPending ? "Connecting…" : connector ? "Connect wallet" : "No wallet found"}
      </Button>
    );
  }

  if (chainId !== chain.id) {
    return (
      <Button variant="down" size="sm" disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
        Switch to {chain.name}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs tabular-nums text-muted" title={address}>
        {shortHash(address)}
      </span>
      <Button size="sm" onClick={() => disconnect()}>
        Disconnect
      </Button>
    </div>
  );
}
