import { create } from "zustand";
import type { Side } from "@orionis/sdk";

/// Terminal selection that several panels share. Server data lives in TanStack Query, not here.
interface TerminalState {
  /// Market symbol, e.g. "NVDA". Empty until the market list loads and the first is chosen.
  symbol: string;
  setSymbol: (symbol: string) => void;
  /// Long or short on the perpetual order panel. Shared so the phone's Long / Short bar can set it
  /// before opening the panel.
  side: Side;
  setSide: (side: Side) => void;
}

export const useTerminal = create<TerminalState>((set) => ({
  symbol: "",
  setSymbol: (symbol) => set({ symbol }),
  side: "LONG",
  setSide: (side) => set({ side }),
}));
