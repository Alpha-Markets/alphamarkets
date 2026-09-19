"use client";

import { Panel } from "@orionis/ui";
import { formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";
import { usePerpMarket, usePositions } from "@/hooks/queries";
import { PRICE_DECIMALS } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { useTerminal } from "@/stores/terminal";
import { margin } from "@orionis/sdk";

const MAX_POINTS = 300;
const W = 1000;
const H = 320;

const toNumber = (value: bigint) => Number(formatUnits(value, PRICE_DECIMALS));

/// Mark price collected since this page opened. The API does not serve price history yet, so
/// this is a live session line, not a historical chart — the panel says so.
export function PriceChart() {
  const symbol = useTerminal((state) => state.symbol);
  const { data, dataUpdatedAt } = usePerpMarket(symbol);
  const { data: positions } = usePositions();
  const [points, setPoints] = useState<number[]>([]);

  useEffect(() => setPoints([]), [symbol]);
  useEffect(() => {
    if (!data) return;
    setPoints((current) => [...current, toNumber(data.markPrice)].slice(-MAX_POINTS));
    // A new sample arrives whenever the query refetches.
  }, [dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => {
    if (!data) return [];
    const open = positions?.perps.filter((p) => p.open && symbolOf(p.marketId) === symbol) ?? [];
    return open.flatMap((position) => [
      { label: "Entry", price: toNumber(position.entryPrice), tone: "text-text" },
      {
        label: "Liquidation",
        price: toNumber(
          margin.liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, data.risk.maintenanceMarginRateBps),
        ),
        tone: "text-down",
      },
    ]);
  }, [data, positions, symbol]);

  const all = [...points, ...lines.map((line) => line.price)];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min || max * 0.002 || 1) * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const y = (price: number) => H - ((price - lo) / (hi - lo)) * H;
  const x = (index: number) => (points.length < 2 ? 0 : (index / (MAX_POINTS - 1)) * W + (W - ((points.length - 1) / (MAX_POINTS - 1)) * W));

  return (
    <Panel title={`${symbol || "Market"}-PERP · mark price this session`} className="min-h-0 flex-1">
      <div className="min-h-0 flex-1 p-3">
        {points.length < 2 ? (
          <p className="text-muted">Collecting prices… history is not available yet, so the line builds as prices arrive.</p>
        ) : (
          <div className="relative h-full w-full">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Mark price this session">
              {lines.map((line) => (
                <line key={line.label} x1={0} x2={W} y1={y(line.price)} y2={y(line.price)} stroke="currentColor" strokeDasharray="4 6" className={line.tone} vectorEffect="non-scaling-stroke" />
              ))}
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                className="text-text"
                points={points.map((price, index) => `${x(index)},${y(price)}`).join(" ")}
              />
            </svg>
            <span className="pointer-events-none absolute right-0 top-0 text-xs tabular-nums text-muted">{hi.toFixed(2)}</span>
            <span className="pointer-events-none absolute bottom-0 right-0 text-xs tabular-nums text-muted">{lo.toFixed(2)}</span>
            {lines.map((line) => (
              <span
                key={line.label}
                className={`pointer-events-none absolute left-0 -translate-y-full text-xs ${line.tone}`}
                style={{ top: `${(y(line.price) / H) * 100}%` }}
              >
                {line.label} {line.price.toFixed(2)}
              </span>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
