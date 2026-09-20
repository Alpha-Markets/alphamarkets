"use client";

import { Button, cn, textLink } from "@alphamarkets/ui";
import { useEffect } from "react";
import type { TxStatus } from "@alphamarkets/sdk";
import { alphaMarketsRead } from "@/lib/alphamarkets";
import { shortHash } from "@/lib/format";
import { useTxStore, type TxRecord } from "@/stores/tx";

/// PROJECT_BRIEF.md Section 30: Preparing, Awaiting Wallet, Submitted, Confirming, then
/// Confirmed or Failed.
const steps: Array<{ status: TxStatus; label: string }> = [
  { status: "preparing", label: "Preparing" },
  { status: "awaiting_wallet", label: "Awaiting wallet" },
  { status: "submitted", label: "Submitted" },
  { status: "confirming", label: "Confirming" },
  { status: "confirmed", label: "Confirmed" },
];

function explorerLink(hash: `0x${string}` | undefined): string | undefined {
  if (!hash) return undefined;
  try {
    return alphaMarketsRead.explorer.txUrl(hash);
  } catch {
    return undefined; // NEXT_PUBLIC_EXPLORER_URL is not set
  }
}

function Toast({ record }: { record: TxRecord }) {
  const dismiss = useTxStore((state) => state.dismiss);
  const failed = record.status === "failed";
  const done = record.status === "confirmed";
  const activeIndex = steps.findIndex((step) => step.status === record.status);
  const link = explorerLink(record.hash);

  // A confirmed transaction has said what it needed to; failures stay until dismissed.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => dismiss(record.id), 12_000);
    return () => clearTimeout(timer);
  }, [done, dismiss, record.id]);

  return (
    <li className="pointer-events-auto w-full rounded-lg border border-line bg-raised p-3 sm:w-80">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{done ? `${record.title} confirmed` : failed ? `${record.title} failed` : record.title}</p>
        {done || failed ? (
          <Button variant="secondary" size="sm" className="-mt-1" onClick={() => dismiss(record.id)} aria-label="Dismiss">
            Close
          </Button>
        ) : null}
      </div>

      {failed ? (
        <p className="mt-2 leading-snug text-down">{record.error}</p>
      ) : (
        <ol className="mt-3 flex gap-1" aria-label="Progress">
          {steps.map((step, index) => (
            <li
              key={step.status}
              title={step.label}
              className={cn("h-0.5 flex-1", index <= activeIndex ? (done ? "bg-up" : "bg-accent") : "bg-line")}
            />
          ))}
        </ol>
      )}

      {!failed && !done ? (
        <p className="mt-2 text-xs text-muted">{steps[activeIndex]?.label ?? "Preparing"}…</p>
      ) : null}

      {done && record.summary ? <p className="mt-2 tabular-nums text-muted">{record.summary}</p> : null}

      {record.hash ? (
        <p className="mt-2 flex items-center justify-between text-xs text-muted">
          <span className="tabular-nums">{shortHash(record.hash)}</span>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className={textLink}>
              View on explorer
            </a>
          ) : null}
        </p>
      ) : null}
      {done && record.blockNumber !== undefined ? (
        <p className="mt-1 text-xs tabular-nums text-muted">Block {record.blockNumber.toString()}</p>
      ) : null}
      {done && record.positionId !== undefined ? (
        <p className="mt-1 text-xs tabular-nums text-muted">Position #{record.positionId.toString()}</p>
      ) : null}
    </li>
  );
}

export function TxToasts() {
  const records = useTxStore((state) => state.records);
  return (
    <ul aria-live="polite" className="pointer-events-none fixed inset-x-3 top-14 z-50 flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-auto">
      {records.map((record) => (
        <Toast key={record.id} record={record} />
      ))}
    </ul>
  );
}
