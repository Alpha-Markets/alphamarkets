"use client";

import { Button } from "@orionis/ui";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useDismiss } from "@/hooks/useDismiss";
import { shortHash } from "@/lib/format";
import { orionisRead } from "@/lib/orionis";
import { chain } from "@/lib/wagmi";
import { ConnectButton } from "./ConnectButton";

const item = "flex h-9 w-full items-center px-3 text-left text-sm hover:bg-line";

function explorerAddressUrl(address: `0x${string}`): string | undefined {
  try {
    return orionisRead.explorer.addressUrl(address);
  } catch {
    return undefined; // NEXT_PUBLIC_EXPLORER_URL is not set
  }
}

/// Connect, switch network, or open the account menu — whichever the wallet needs next.
export function WalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (!isConnected || !address) return <ConnectButton size="sm" className="max-md:h-9" />;

  if (chainId !== chain.id) {
    return (
      <Button variant="down" size="sm" className="max-md:h-9" disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
        Switch to {chain.name}
      </Button>
    );
  }

  const explorer = explorerAddressUrl(address);

  return (
    <div ref={ref} className="relative">
      <Button size="sm" className="max-md:h-9" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
        <span className="tabular-nums" title={address}>
          {shortHash(address)}
        </span>
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-raised py-1">
          <p className="px-3 py-1.5 text-xs text-muted">Connected to {chain.name}</p>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              void navigator.clipboard?.writeText(address).then(() => setCopied(true));
            }}
          >
            {copied ? "Address copied" : "Copy address"}
          </button>
          {explorer ? (
            <a role="menuitem" href={explorer} target="_blank" rel="noreferrer" className={item}>
              View on explorer
            </a>
          ) : null}
          <Link role="menuitem" href="/portfolio" className={item} onClick={close}>
            Portfolio
          </Link>
          <button
            type="button"
            role="menuitem"
            className={`${item} border-t border-line text-down`}
            onClick={() => {
              close();
              disconnect();
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
