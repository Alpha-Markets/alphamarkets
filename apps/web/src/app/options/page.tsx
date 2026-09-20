import { OptionChain } from "@/components/OptionChain";
import { OptionPositions } from "@/components/OptionPositions";
import { OptionTradeSheet } from "@/components/OptionTradeSheet";

/// PROJECT_BRIEF.md Sections 25-26, desktop-first: chain and open positions on the left, the
/// order ticket on the right. The underlying and expiry selectors live in the chain panel. Under
/// 1024px the ticket opens as a sheet when a series is picked.
export default function OptionsTerminal() {
  return (
    <div className="grid gap-px bg-line lg:h-full lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-h-0 flex-col gap-px lg:overflow-y-auto">
        <OptionChain />
        <OptionPositions />
      </div>
      <OptionTradeSheet />
    </div>
  );
}
