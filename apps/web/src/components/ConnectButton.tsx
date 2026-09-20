"use client";

import { Button, type ButtonProps } from "@orionis/ui";
import { useCallback, useRef, useState } from "react";
import { useConnect } from "wagmi";
import { useDismiss } from "@/hooks/useDismiss";

/// Wallets the page can offer. Browsers that announce their wallets (EIP-6963) give one connector
/// per wallet, so the generic "Injected" connector is left out when any of those exist.
function useWalletChoices() {
  const { connectors } = useConnect();
  const named = connectors.filter((connector) => connector.id !== "injected");
  return named.length > 0 ? named : connectors;
}

function connectMessage(error: Error): string {
  return error.name === "ProviderNotFoundError"
    ? "No browser wallet found. Install MetaMask or another EVM wallet, then reload this page."
    : `Could not connect: ${error.message.split("\n")[0]}`;
}

/// One button for every place that needs a wallet. With one wallet available it connects straight
/// away; with several it opens a list; when connecting fails it says why.
export function ConnectButton({ variant = "primary", size = "md", className }: Pick<ButtonProps, "variant" | "size" | "className">) {
  const { connect, isPending, error, reset } = useConnect();
  const choices = useWalletChoices();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);
  useDismiss(ref, open, close);

  function start() {
    if (choices.length === 1) {
      setOpen(false);
      connect({ connector: choices[0]! }, { onError: () => setOpen(true) });
    } else {
      setOpen((value) => !value);
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button variant={variant} size={size} className={className} disabled={isPending} aria-haspopup={choices.length > 1 ? "menu" : undefined} aria-expanded={open} onClick={start}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-64 border border-line bg-raised p-1">
          {error ? (
            <p role="alert" className="p-2 text-xs leading-snug text-down">
              {connectMessage(error)}
            </p>
          ) : null}
          {choices.length === 0 ? (
            <p className="p-2 text-xs leading-snug text-muted">No browser wallet found. Install MetaMask or another EVM wallet, then reload this page.</p>
          ) : (
            choices.map((connector) => (
              <button
                key={connector.uid}
                type="button"
                role="menuitem"
                onClick={() => {
                  reset();
                  connect({ connector }, { onSuccess: () => setOpen(false) });
                }}
                className="flex h-9 w-full items-center gap-2 px-2 text-left text-sm hover:bg-line"
              >
                {connector.name}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
