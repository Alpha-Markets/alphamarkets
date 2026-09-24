"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";
import { env } from "@/lib/env";
import { FillIndex, parseCursor } from "@/lib/fills";
import { readHistoryAfter } from "@/lib/history";
import { useFillStore } from "@/stores/fills";

const POLL_MS = 6_000;

function readCursor(key: string): number | undefined {
  try {
    return parseCursor(localStorage.getItem(key));
  } catch {
    return undefined;
  }
}

function writeCursor(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage blocked: fills already shown this session are still not repeated, only a reload can repeat them.
  }
}

/// Watches the connected wallet's history for positions the protocol closed on the user's behalf —
/// a stop-loss or take-profit trigger firing, or a liquidation — and hands each to the alert queue.
///
/// On load it reads the whole history once (to learn which order was a stop-loss, and each position's
/// side). Events after the cursor saved from the last visit are fills the user missed and arrive as a
/// catch-up. With no saved cursor (first visit, or new browser) nothing is replayed: old fills are not news.
export function useTriggerFills(): void {
  const { address } = useAccount();
  const push = useFillStore((state) => state.push);

  useEffect(() => {
    if (!address || !env.apiUrl) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const index = new FillIndex();
    const key = `alpha:fills-cursor:${address.toLowerCase()}`;
    let cursor = 0;

    const poll = async () => {
      try {
        const events = await readHistoryAfter(address, cursor);
        if (cancelled) return;
        const last = events[events.length - 1];
        if (last) {
          index.learn(events);
          cursor = last.id;
          writeCursor(key, cursor);
          push(index.fillsIn(events), false);
        }
      } catch {
        // The API is briefly unreachable; the next tick tries again from the same cursor.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    const start = async () => {
      try {
        const saved = readCursor(key);
        const all = await readHistoryAfter(address, 0);
        if (cancelled) return;
        index.learn(all);
        cursor = all[all.length - 1]?.id ?? 0;
        writeCursor(key, cursor);
        if (saved !== undefined) push(index.fillsIn(all.filter((event) => event.id > saved)), true);
      } catch {
        // Nothing read: retry the whole start below rather than polling from a cursor we never learned.
        if (!cancelled) timer = setTimeout(start, POLL_MS);
        return;
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };

    void start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [address, push]);
}
