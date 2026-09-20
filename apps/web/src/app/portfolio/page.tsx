import { PageHeader } from "@/components/PageHeader";
import { PortfolioView } from "@/components/PortfolioView";

export default function PortfolioPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px] p-6 lg:p-10">
      <PageHeader title="Portfolio">Your collateral, open positions and orders.</PageHeader>
      <PortfolioView />
    </div>
  );
}
