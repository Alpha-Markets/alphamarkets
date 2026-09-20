import { PageHeader } from "@/components/PageHeader";
import { StrategyBuilder } from "@/components/StrategyBuilder";

/// PROJECT_BRIEF.md Section 41: the options strategy builder. Same page width and padding as
/// Portfolio and Activity.
export default function Strategies() {
  return (
    <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-10">
      <PageHeader title="Strategies">Build an options strategy and see its payoff, cost and break-even before you trade.</PageHeader>
      <StrategyBuilder />
    </div>
  );
}
