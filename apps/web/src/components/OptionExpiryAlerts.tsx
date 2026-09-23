"use client";

import { Button, cn, textLink } from "@alphamarkets/ui";
import { OptionPositionStatus } from "@alphamarkets/sdk";
import { useQueries } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { usePositions } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { alphaMarketsRead } from "@/lib/alphamarkets";
import { env } from "@/lib/env";
import { symbolOf } from "@/lib/market";
import { optionCodeOf, verdictOf } from "@/lib/options";

function readDismissed(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeDismissed(key: string, ids: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage blocked: the card is gone for this session and can come back after a reload.
  }
}

/// Tells the user when an option they hold has expired and still needs a Settle click. Nothing else
/// tells them: settling is manual, and an in-the-money option pays nothing until someone settles it.
/// A calm card, with no sound or confetti. On a wide screen it sits bottom left, clear of the trigger
/// alerts (top right) and the transaction toasts (bottom right).
/// It leaves by itself once the position is settled.
export function OptionExpiryAlerts() {
  const { address } = useAccount();
  const now = useNow();
  const { data } = usePositions();
  const key = address ? `alpha:option-expiry-dismissed:${address.toLowerCase()}` : undefined;
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => setDismissed(key ? readDismissed(key) : new Set()), [key]);

  const expired = useMemo(() => {
    if (now === 0) return [];
    const seconds = BigInt(Math.floor(now / 1000));
    return (data?.options ?? []).filter(
      (position) => position.status === OptionPositionStatus.OPEN && seconds >= position.expiry && !dismissed.has(position.positionId.toString()),
    );
  }, [data, dismissed, now]);

  const symbols = [...new Set(expired.map((position) => symbolOf(position.marketId)))];
  const prices = useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: ["index-price", symbol],
      queryFn: async () => (await alphaMarketsRead.prices.get(symbol)).index.price,
      enabled: Boolean(env.apiUrl),
      staleTime: 15_000,
    })),
  });
  const indexOf = (symbol: string) => prices[symbols.indexOf(symbol)]?.data;

  if (!key || expired.length === 0) return null;

  const rows = expired.map((position) => ({ position, verdict: verdictOf(position, indexOf(symbolOf(position.marketId))) }));
  const itm = rows.filter((row) => row.verdict === "ITM").length;
  const title = itm > 0 ? "Options expired in the money" : "Options expired";
  const subline =
    itm > 0
      ? "Settle them to collect your payout. It stays uncollected until you do."
      : "Settle them to release your collateral. An option that expires out of the money pays nothing.";

  function dismissAll() {
    const next = new Set(dismissed);
    for (const { position } of rows) next.add(position.positionId.toString());
    setDismissed(next);
    if (key) writeDismissed(key, next);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-40 sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-96"
    >
      <div className={cn("pointer-events-auto rounded-lg border bg-raised p-4", itm > 0 ? "border-up/60" : "border-line")}>
        <p className="text-base font-semibold">{title}</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {rows.map(({ position, verdict }) => (
            <li key={position.positionId.toString()} className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{optionCodeOf(position)}</span>
              <span className={cn("text-xs", verdict === "ITM" ? "text-up" : "text-muted")}>
                {verdict === "ITM" ? "In the money" : verdict === "OTM" ? "Out of the money" : "Awaiting price"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm leading-snug text-muted">{subline}</p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Link href="/options" className={cn("text-xs", textLink)} onClick={dismissAll}>
            Go to Settle
          </Link>
          <Button variant="secondary" size="sm" onClick={dismissAll}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
