"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { TxOptions } from "@alphamarkets/sdk";
import { useTxStore } from "@/stores/tx";

/// Runs one SDK write and mirrors its Section 30 states into the confirmation panel. The SDK
/// already turns reverts into typed errors and emits every state, so this only wires them up.
export function useTx() {
  const start = useTxStore((state) => state.start);
  const update = useTxStore((state) => state.update);
  const patch = useTxStore((state) => state.patch);
  const queryClient = useQueryClient();

  return async function run<T>(
    meta: { title: string; summary?: string },
    action: (tx: TxOptions) => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    const id = start(meta.title, meta.summary);
    try {
      const value = await action({ wait: true, onStatus: (event) => update(id, event) });
      if (typeof value === "object" && value !== null && "positionId" in value) {
        patch(id, { positionId: (value as { positionId: bigint }).positionId });
      }
      // A confirmed write changes balances, positions and prices.
      void queryClient.invalidateQueries();
      return { ok: true, value };
    } catch {
      // The failure is already on the record via `onStatus`.
      return { ok: false };
    }
  };
}
