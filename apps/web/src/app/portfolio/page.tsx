import { Header } from "@/components/Header";
import { PortfolioView } from "@/components/PortfolioView";
import { TxToasts } from "@/components/TxToasts";

export default function PortfolioPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header current="Portfolio" />
      <main className="mx-auto w-full max-w-[1400px] flex-1 p-4">
        <PortfolioView />
      </main>
      <TxToasts />
    </div>
  );
}
