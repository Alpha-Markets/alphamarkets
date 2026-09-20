import { Suspense } from "react";
import { MarketHeader } from "@/components/MarketHeader";
import { MarketAnalytics } from "@/components/MarketAnalytics";
import { MarketFromUrl, MarketList } from "@/components/MarketList";
import { OrderPanel } from "@/components/OrderPanel";
import { PerpTradeBar } from "@/components/PerpTradeBar";
import { PriceChart } from "@/components/PriceChart";
import { TradeSheet } from "@/components/TradeSheet";

/// PROJECT_BRIEF.md Section 24, desktop-first: market list on the left, chart and positions in
/// the middle, order panel on the right. Below 1280px the list moves into the price header, and
/// below 1024px the order panel opens as a sheet from the bar at the bottom.
export default function PerpetualsTerminal() {
  return (
    <div className="flex flex-col lg:h-full">
      <div className="grid grid-cols-1 gap-1.5 p-1.5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[220px_minmax(0,1fr)_340px]">
        <Suspense fallback={null}>
          <MarketFromUrl />
        </Suspense>
        <div className="hidden min-h-0 xl:block">
          <MarketList />
        </div>
        <div className="flex min-h-0 flex-col gap-1.5 lg:overflow-y-auto">
          <MarketHeader />
          <PriceChart />
          <MarketAnalytics />
        </div>
        <TradeSheet title="Order" bar={<PerpTradeBar />}>
          <OrderPanel />
        </TradeSheet>
      </div>
    </div>
  );
}
