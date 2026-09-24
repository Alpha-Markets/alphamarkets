"use client";

import { useQueries } from "@tanstack/react-query";
import { alphaMarketsRead } from "@/lib/alphamarkets";
import { usePerpMarkets, useSettlementDecimals } from "@/hooks/queries";
import { fmtBps, fmtUsd } from "@/lib/format";
import { MONO } from "@/lib/frame";
import { symbolOf } from "@/lib/market";
import { cn } from "@alphamarkets/ui";
import type { Hex } from "@alphamarkets/types";

const HEAD = "px-3 py-2 text-left text-xs font-medium text-muted";
const CELL = cn(MONO, "px-3 py-3 text-sm whitespace-nowrap");

/// Every number here is read from the chain when the page opens (RiskManager, FeeManager and
/// FundingManager through the SDK), never typed into this file. Fees, leverage tiers and caps are
/// per-market settings an admin can change, so a docs page that printed them as fixed facts would go
/// stale; this table cannot.
export function DocsLiveParameters() {
    const markets = usePerpMarkets();
    const decimals = useSettlementDecimals();
    const rows = useQueries({
        queries: (markets.data ?? []).map((market) => ({
            queryKey: ["docs-market-parameters", market.marketId],
            queryFn: async () => {
                const symbol = symbolOf(market.marketId as Hex);
                const [info, fees] = await Promise.all([
                    alphaMarketsRead.perps.get(symbol),
                    alphaMarketsRead.fees.get(symbol),
                ]);
                return { symbol, info, fees };
            },
            staleTime: 30_000,
        })),
    });

    if (markets.isError || decimals.isError) {
        return (
            <p role="alert" className="text-down">
                Could not read the chain, so live parameters are not shown. Check the RPC connection and reload the page.
            </p>
        );
    }
    if (markets.isPending || decimals.isPending || rows.some((row) => row.isPending)) {
        return <p className="text-muted">Reading parameters from the chain…</p>;
    }
    const loaded = rows.flatMap((row) => (row.data ? [row.data] : []));
    if (loaded.length === 0) return <p className="text-muted">No market is listed on the registry yet.</p>;
    const dec = decimals.data ?? 6;

    return (
        <div className="overflow-x-auto rounded-panel bg-surface">
            <table className="w-full min-w-[56rem] border-collapse">
                <caption className="sr-only">Live per-market parameters read from the chain</caption>
                <thead>
                    <tr className="border-b border-line">
                        <th scope="col" className={HEAD}>Market</th>
                        <th scope="col" className={HEAD}>Leverage tiers</th>
                        <th scope="col" className={HEAD}>Initial margin</th>
                        <th scope="col" className={HEAD}>Maintenance margin</th>
                        <th scope="col" className={HEAD}>Max position</th>
                        <th scope="col" className={HEAD}>Open interest cap</th>
                        <th scope="col" className={HEAD}>Taker fee</th>
                        <th scope="col" className={HEAD}>Option open / close</th>
                        <th scope="col" className={HEAD}>Settlement fee</th>
                        <th scope="col" className={HEAD}>Liquidation fee</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-line">
                    {loaded.map(({ symbol, info, fees }) => (
                        <tr key={symbol}>
                            <th scope="row" className={cn(CELL, "text-left font-medium")}>{symbol}</th>
                            <td className={CELL}>{info.risk.allowedLeverageTiers.map((tier) => `${tier}x`).join(", ")}</td>
                            <td className={CELL}>{fmtBps(info.risk.initialMarginRateBps)}</td>
                            <td className={CELL}>{fmtBps(info.risk.maintenanceMarginRateBps)}</td>
                            <td className={CELL}>{fmtUsd(info.risk.maxPositionNotional, dec, 0)}</td>
                            <td className={CELL}>{fmtUsd(info.risk.openInterestCap, dec, 0)}</td>
                            <td className={CELL}>{fmtBps(fees.takerFee)}</td>
                            <td className={CELL}>{fmtBps(fees.optionOpenFee)} / {fmtBps(fees.optionCloseFee)}</td>
                            <td className={CELL}>{fmtBps(fees.settlementFee)}</td>
                            <td className={CELL}>{fmtBps(fees.liquidationFee)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
