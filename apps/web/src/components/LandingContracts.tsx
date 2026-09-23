"use client";

import { cn } from "@alphamarkets/ui";
import { useState } from "react";
import { CONTRACTS } from "@/lib/contracts";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { MONO, PAGE_FRAME } from "@/lib/frame";
import { ArrowIcon } from "./ArrowIcon";
import { SectionHeader } from "./SectionHeader";
import { StatusBadge } from "./StatusBadge";

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

/// One deployed contract: its name, what it does, and its own full address to verify on the
/// explorer — a card, not a row, so the description has room the old hairline grid never gave it.
/// The address shows in full (`break-all`, not truncated): a partial address is not something a
/// reader can actually verify against the explorer without trusting this page got the rest right.
/// It also copies to the clipboard directly, and still opens the explorer as a link — verifying a
/// contract shouldn't require leaving the page first.
function ContractCard({ label, description, address }: { label: string; description: string; address: `0x${string}` | undefined }) {
  const [copied, setCopied] = useState(false);
  const url = address ? explorerAddressUrl(env.explorerUrl, address) : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-transparent bg-surface p-6 transition-colors duration-150 hover:border-accent lg:p-7">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-medium">{label}</h3>
        <StatusBadge label={url ? "Verified" : "Not deployed"} tone={url ? "up" : "faint"} />
      </div>
      <p className="text-muted">{description}</p>
      {address ? (
        <div className="mt-auto flex items-start gap-2 rounded-control bg-raised px-3 py-2">
          <span className={cn(MONO, "flex-1 break-all text-sm text-text")}>{address}</span>
          <button
            type="button"
            aria-label={copied ? "Address copied" : "Copy address"}
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
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" aria-label={`View ${label} on the explorer`} className="shrink-0 rounded-control p-1 text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-accent">
              <ArrowIcon className="size-3.5" />
            </a>
          ) : null}
        </div>
      ) : (
        <p className={cn(MONO, "mt-auto text-sm text-faint")}>Not deployed</p>
      )}
    </div>
  );
}

/// Every contract in the deployment, so a reader can verify all of it directly instead of taking
/// custody and settlement on trust — each as a card naming what it does, not just a label and an
/// address. Some are optional in older deployments (see `lib/contracts.ts`) and render as "not
/// deployed" rather than being left off the list, so the count here always matches what the FAQ
/// below claims ("every contract AlphaMarkets runs on is listed").
export function LandingContracts() {
  return (
    <section aria-labelledby="landing-contracts" className="py-16 lg:py-24">
      <SectionHeader id="landing-contracts" title="Smart contracts">
        <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
          Every contract AlphaMarkets runs on, all {CONTRACTS.length} of them.
          Collateral, positions and settlement are checkable onchain, not
          taken on trust.
        </p>
      </SectionHeader>
      <div className={cn(PAGE_FRAME, "mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3")}>
        {CONTRACTS.map((contract) => (
          <ContractCard key={contract.label} {...contract} />
        ))}
      </div>
    </section>
  );
}
