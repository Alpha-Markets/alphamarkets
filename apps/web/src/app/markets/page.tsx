import { MarketsTable } from "@/components/MarketsTable";
import { PageHeader } from "@/components/PageHeader";

export default function MarketsPage() {
  return (
    <div className="p-4">
      <PageHeader title="Markets">Every listed market. Open a row to trade its perpetual, or go straight to its options.</PageHeader>
      <MarketsTable />
    </div>
  );
}
