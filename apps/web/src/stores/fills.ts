import { create } from "zustand";
import type { Fill } from "@/lib/fills";

/// One thing to show the user: a single fill, or, after they were away, one summary of several.
export type FillAlert = { id: string; type: "fill"; fill: Fill } | { id: string; type: "summary"; fills: Fill[] };

interface FillState {
  /// Alerts waiting their turn. The first one is on screen.
  alerts: FillAlert[];
  /// `catchUp` marks fills found on load that happened while the user was away: several of them
  /// become one summary instead of a stack of celebrations.
  push: (fills: Fill[], catchUp: boolean) => void;
  dismiss: (id: string) => void;
}

export const useFillStore = create<FillState>((set) => ({
  alerts: [],
  push: (fills, catchUp) => {
    if (fills.length === 0) return;
    const added: FillAlert[] =
      catchUp && fills.length > 1
        ? [{ id: `summary-${fills[fills.length - 1]?.id}`, type: "summary", fills }]
        : fills.map((fill) => ({ id: `fill-${fill.id}`, type: "fill", fill }));
    set((state) => {
      const known = new Set(state.alerts.map((alert) => alert.id));
      return { alerts: [...state.alerts, ...added.filter((alert) => !known.has(alert.id))] };
    });
  },
  dismiss: (id) => set((state) => ({ alerts: state.alerts.filter((alert) => alert.id !== id) })),
}));
