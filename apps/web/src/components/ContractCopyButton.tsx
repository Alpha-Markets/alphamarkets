"use client";

import { cn } from "@alphamarkets/ui";
import { useState } from "react";

function CopyIcon({ copied }: { copied: boolean }) {
  return copied ? (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" className="size-3.5 shrink-0">
      <path d="M2.5 6.5l2.4 2.4L9.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="size-3.5 shrink-0">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <path d="M1.5 8.5v-6a1 1 0 0 1 1-1h6" />
    </svg>
  );
}

/// The one interactive bit of a contract card — isolated into its own client leaf so
/// `LandingContracts` and its static list can stay a server component.
export function ContractCopyButton({ address, label }: { address: `0x${string}`; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Address copied" : `Copy ${label} address`}
      onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className={cn(
        "shrink-0 rounded-control p-1 text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-accent",
        copied && "text-up",
      )}
    >
      <CopyIcon copied={copied} />
    </button>
  );
}
