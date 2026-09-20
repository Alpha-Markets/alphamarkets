import { Num, toneOf } from "@orionis/ui";
import type { MarketStats } from "@orionis/sdk";
import { useMarketStats } from "@/hooks/queries";
import { symbolOf } from "@/lib/market";

/// The indexer's statistics row for one market symbol, or undefined while it loads or when the
/// statistics service is off.
export function useStatsFor(symbol: string): MarketStats | undefined {
  const { data } = useMarketStats();
  return symbol ? data?.find((row) => symbolOf(row.marketId) === symbol) : undefined;
}

/// "+1.25%" with the sign and market colour; a shorter-than-24h window is called out so a move
/// over twenty minutes is not mistaken for a day's.
export function Change({ stats, className }: { stats?: MarketStats; className?: string }) {
  if (!stats || stats.change24hBps === null) return <Num tone="muted" className={className}>–</Num>;
  const bps = stats.change24hBps;
  const text = `${bps > 0 ? "+" : bps < 0 ? "−" : ""}${(Math.abs(bps) / 100).toFixed(2)}%`;
  const partial = stats.changeWindowSeconds < 86_400;
  return (
    <Num
      tone={toneOf(bps)}
      className={className}
      title={partial ? `Change over the last ${Math.max(1, Math.round(stats.changeWindowSeconds / 60))} minutes; 24h of history is not collected yet` : undefined}
    >
      {text}
      {partial ? "*" : ""}
    </Num>
  );
}
