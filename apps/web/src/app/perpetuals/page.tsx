import { Header } from "@/components/Header";
import { MarketHeader } from "@/components/MarketHeader";
import { MarketList } from "@/components/MarketList";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsTable } from "@/components/PositionsTable";
import { PriceChart } from "@/components/PriceChart";
import { env } from "@/lib/env";
import { TxToasts } from "@/components/TxToasts";

/// PROJECT_BRIEF.md Section 24, desktop-first: market list on the left, chart and positions in
/// the middle, order panel on the right.
export default function PerpetualsTerminal() {
  return (
    <div className="flex h-screen flex-col">
      <Header current="Perpetuals" />
      {env.rpcConfigured ? null : (
        <p role="alert" className="border-b border-line bg-raised px-4 py-2 text-down">
          NEXT_PUBLIC_RPC_URL is not set, so no market data can load. Add it to .env and restart.
        </p>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_340px] gap-px bg-line">
        <MarketList />
        <div className="flex min-h-0 flex-col gap-px">
          <MarketHeader />
          <PriceChart />
          <PositionsTable />
        </div>
        <OrderPanel />
      </main>
      <TxToasts />
    </div>
  );
}
