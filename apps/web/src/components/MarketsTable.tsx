"use client";

import { Num, Panel, cn, toneOf } from "@orionis/ui";
import Link from "next/link";
import type { MarketStats } from "@orionis/sdk";
import type { MarketConfig } from "@orionis/types";
import { useAllMarkets, useMarketOverview, useMarketStats, useSettlementDecimals } from "@/hooks/queries";
import { env } from "@/lib/env";
import { fmt, fmtBps, fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2.5 text-right tabular-nums first:text-left";

const linkClass = "inline-flex h-7 items-center rounded-[3px] border border-line px-2.5 text-xs font-medium hover:border-faint hover:bg-raised";

/// "+1.25%" with the sign and market colour; a shorter-than-24h window is called out so a move
/// over twenty minutes is not mistaken for a day's.
function Change({ stats }: { stats?: MarketStats }) {
  if (!stats || stats.change24hBps === null) return <Num tone="muted">–</Num>;
  const bps = stats.change24hBps;
  const text = `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${(Math.abs(bps) / 100).toFixed(2)}%`;
  const partial = stats.changeWindowSeconds < 86_400;
  return (
    <Num tone={toneOf(bps)} title={partial ? `Change over the last ${Math.max(1, Math.round(stats.changeWindowSeconds / 60))} minutes; 24h of history is not collected yet` : undefined}>
      {text}
      {partial ? "*" : ""}
    </Num>
  );
}

function Row({ market, stats, decimals }: { market: MarketConfig; stats?: MarketStats; decimals: number }) {
  const symbol = symbolOf(market.marketId);
  const { data } = useMarketOverview(symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);

  return (
    <tr className="border-t border-line">
      <td className={cell}>
        <span className="font-medium">{symbol}</span>
      </td>
      <td className={cell}>{fmtPrice(data?.prices?.index.price)}</td>
      <td className={cell}>
        <Change stats={stats} />
      </td>
      <td className={cell}>{stats && market.optionsEnabled ? `$${fmt(stats.optionsVolume24h, decimals, 0)}` : "–"}</td>
      <td className={cell}>{stats && market.perpsEnabled ? `$${fmt(stats.perpVolume24h, decimals, 0)}` : "–"}</td>
      <td className={cell}>{market.perpsEnabled && data?.openInterest ? `$${fmt(data.openInterest.total, decimals, 0)}` : "–"}</td>
      <td className={cell}>{market.perpsEnabled ? fmtBps(data?.funding?.currentFundingRateBps) : "–"}</td>
      <td className={cell} title="Implied volatility needs a live options market; the pricing service uses a flat assumed volatility.">
        –
      </td>
      <td className={cn(cell, market.active ? "text-up" : "text-down")}>{market.active ? "Active" : "Paused"}</td>
      <td className={cn(cell, "space-x-2")}>
        {market.optionsEnabled ? (
          <Link href="/options" onClick={() => setSymbol(symbol)} className={linkClass}>
            Trade options
          </Link>
        ) : null}
        {market.perpsEnabled ? (
          <Link href={`/perpetuals?market=${symbol}`} className={linkClass}>
            Trade perps
          </Link>
        ) : null}
      </td>
    </tr>
  );
}

/// PROJECT_BRIEF.md Section 29. Every market on the registry appears, so a market added by
/// configuration shows up here with no code change.
export function MarketsTable() {
  const { data: markets, isPending, error } = useAllMarkets();
  const { data: stats, isError: statsUnavailable } = useMarketStats();
  const { data: decimals = 6 } = useSettlementDecimals();
  const byId = new Map((stats ?? []).map((row) => [row.marketId, row]));

  return (
    <Panel title="Markets">
      <div className="overflow-x-auto">
        {isPending ? (
          <p className="p-3 text-muted">Loading markets…</p>
        ) : error ? (
          <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
        ) : markets.length === 0 ? (
          <p className="p-3 text-muted">No markets are listed on the registry yet.</p>
        ) : (
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr>
                <th className={head}>Asset</th>
                <th className={head}>Index price</th>
                <th className={head}>24h</th>
                <th className={head}>Options volume</th>
                <th className={head}>Perp volume</th>
                <th className={head}>Open interest</th>
                <th className={head}>Funding</th>
                <th className={head}>IV</th>
                <th className={head}>Status</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {markets.map((market) => (
                <Row key={market.marketId} market={market} stats={byId.get(market.marketId)} decimals={decimals} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {!env.apiUrl ? (
        <p className="border-t border-line p-3 text-muted">
          24h change and volumes come from the indexer. Set NEXT_PUBLIC_API_URL to show them.
        </p>
      ) : statsUnavailable ? (
        <p className="border-t border-line p-3 text-down">The statistics service is not responding, so 24h change and volumes are hidden.</p>
      ) : (
        <p className="border-t border-line p-3 text-xs text-muted">
          Volumes are for the last 24 hours, in USD. Options volume is the premium paid on new positions.
        </p>
      )}
    </Panel>
  );
}
