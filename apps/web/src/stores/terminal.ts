import { create } from "zustand";

/// Terminal selection that several panels share. Server data lives in TanStack Query, not here.
interface TerminalState {
  /// Market symbol, e.g. "NVDA". Empty until the market list loads and the first is chosen.
  symbol: string;
  setSymbol: (symbol: string) => void;
}

export const useTerminal = create<TerminalState>((set) => ({
  symbol: "",
  setSymbol: (symbol) => set({ symbol }),
}));
