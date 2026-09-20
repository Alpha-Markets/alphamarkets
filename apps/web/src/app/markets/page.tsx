import { Header } from "@/components/Header";
import { MarketsTable } from "@/components/MarketsTable";
import { TxToasts } from "@/components/TxToasts";

export default function MarketsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header current="Markets" />
      <main className="flex-1 p-4">
        <MarketsTable />
      </main>
      <TxToasts />
    </div>
  );
}
