import { Suspense } from "react";
import { MarketHeader } from "@/components/MarketHeader";
import { MarketAnalytics } from "@/components/MarketAnalytics";
import { MarketList } from "@/components/MarketList";
import { OrderPanel } from "@/components/OrderPanel";
import { PerpTradeBar } from "@/components/PerpTradeBar";
import { PriceChart } from "@/components/PriceChart";
import { TradeSheet } from "@/components/TradeSheet";

/// PROJECT_BRIEF.md Section 24, desktop-first: market list on the left, chart and positions in
/// the middle, order panel on the right. Under 1024px the list moves into the price header and the
/// order panel opens as a sheet from the bar at the bottom.
export default function PerpetualsTerminal() {
  return (
    <div className="flex flex-col lg:h-full">
      <div className="grid gap-px bg-line lg:min-h-0 lg:flex-1 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        <div className="hidden min-h-0 lg:block">
          <Suspense fallback={null}>
            <MarketList />
          </Suspense>
        </div>
        <div className="flex min-h-0 flex-col gap-px lg:overflow-y-auto">
          <MarketHeader />
          <PriceChart />
          <MarketAnalytics />
        </div>
        <TradeSheet title="Order" bar={(open) => <PerpTradeBar open={open} />}>
          <OrderPanel />
        </TradeSheet>
      </div>
    </div>
  );
}
