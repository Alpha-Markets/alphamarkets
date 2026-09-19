"use client";

import { Num, Panel, cn } from "@orionis/ui";
import { useEffect } from "react";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import type { Hex } from "@orionis/types";

function MarketRow({ marketId }: { marketId: Hex }) {
  const symbol = symbolOf(marketId);
  const selected = useTerminal((state) => state.symbol === symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const { data } = usePerpMarket(symbol);

  return (
    <li>
      <button
        type="button"
        onClick={() => setSymbol(symbol)}
        aria-pressed={selected}
        className={cn(
          "grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 border-l-2 px-3 py-2 text-left",
          selected ? "border-text bg-raised" : "border-transparent hover:bg-raised/60",
        )}
      >
        <span className="font-medium">{symbol}</span>
        <Num>{fmtPrice(data?.markPrice)}</Num>
        <span className="text-xs text-muted">Perp</span>
        <Num tone="muted" className="text-xs">
          {fmtBps(data?.funding.currentFundingRateBps)}
        </Num>
      </button>
    </li>
  );
}

export function MarketList() {
  const { data: markets, isPending, error } = usePerpMarkets();
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);

  // Fast market switching starts from a sensible default: the first market the registry lists.
  useEffect(() => {
    const first = markets?.[0];
    if (!symbol && first) setSymbol(symbolOf(first.marketId));
  }, [markets, symbol, setSymbol]);

  return (
    <Panel title="Markets" className="h-full">
      {isPending ? (
        <p className="p-3 text-muted">Loading markets…</p>
      ) : error ? (
        <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
      ) : markets.length === 0 ? (
        <p className="p-3 text-muted">No perpetual markets are listed on the registry yet.</p>
      ) : (
        <ul className="overflow-y-auto">
          {markets.map((market) => (
            <MarketRow key={market.marketId} marketId={market.marketId} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
