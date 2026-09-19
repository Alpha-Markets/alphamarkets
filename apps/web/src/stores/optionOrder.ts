import { create } from "zustand";
import type { OptionSide } from "@orionis/sdk";

/// The series picked in the option chain, which the order ticket then prices. It carries its own
/// underlying and expiry so the ticket stays correct while the chain is showing something else.
export interface OptionSelection {
  symbol: string;
  expiry: bigint;
  strike: bigint;
  type: OptionSide;
}

interface OptionOrderState {
  selection?: OptionSelection;
  select: (selection: OptionSelection | undefined) => void;
}

export const useOptionOrder = create<OptionOrderState>((set) => ({
  selection: undefined,
  select: (selection) => set({ selection }),
}));
