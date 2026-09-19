"use client";

import { Button, Num, Panel, toneOf } from "@orionis/ui";
import { margin } from "@orionis/sdk";
import type { PerpPosition } from "@orionis/types";
import { useAccount } from "wagmi";
import { usePerpMarket, usePositions, useSettlementDecimals } from "@/hooks/queries";
import { useWalletOrionis } from "@/hooks/useOrionis";
import { useTx } from "@/hooks/useTx";
import { fmt, fmtBps, fmtPrice, fmtSigned, fmtUsd } from "@/lib/format";
import { perpLabel, symbolOf } from "@/lib/market";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

function PositionRow({ position, decimals }: { position: PerpPosition; decimals: number }) {
  const symbol = symbolOf(position.marketId);
  const { data: market } = usePerpMarket(symbol);
  const wallet = useWalletOrionis();
  const run = useTx();

  const mark = market?.markPrice;
  const pnl = mark === undefined ? undefined : margin.unrealizedPnl(position.isLong, position.entryPrice, mark, position.size);
  const liquidation = market
    ? margin.liquidationPrice(position.isLong, position.entryPrice, position.collateral, position.size, market.risk.maintenanceMarginRateBps)
    : undefined;
  const ratio = pnl === undefined ? undefined : margin.marginRatioBps(position.collateral, pnl, position.size);
  const leverage = position.collateral === 0n ? 0n : position.size / position.collateral;

  return (
    <tr className="border-t border-line">
      <td className={cell}>
        <span className="font-medium">{perpLabel(position.marketId)}</span>
        <span className={position.isLong ? "ml-2 text-up" : "ml-2 text-down"}>{position.isLong ? "Long" : "Short"}</span>
      </td>
      <td className={cell}>{fmtUsd(position.size, decimals)}</td>
      <td className={cell}>{`${leverage}x`}</td>
      <td className={cell}>{fmtUsd(position.collateral, decimals)}</td>
      <td className={cell}>{fmtPrice(position.entryPrice)}</td>
      <td className={cell}>{fmtPrice(mark)}</td>
      <td className={cell}>{fmtPrice(liquidation)}</td>
      <td className={cell}>{fmtBps(ratio)}</td>
      <td className={cell}>
        <Num tone={pnl === undefined ? "muted" : toneOf(pnl)}>{fmtSigned(pnl, decimals)}</Num>
      </td>
      <td className={cell}>{fmtSigned(position.fundingAccrued, decimals)}</td>
      <td className={cell}>
        <Button
          size="sm"
          disabled={!wallet}
          onClick={() =>
            run(
              { title: "Close position", summary: `${perpLabel(position.marketId)} · ${fmtUsd(position.size, decimals, 0)}` },
              (tx) => wallet!.perps.closePosition(position.positionId, { tx }),
            )
          }
        >
          Close
        </Button>
      </td>
    </tr>
  );
}

export function PositionsTable() {
  const { isConnected } = useAccount();
  const { data, isPending } = usePositions();
  const { data: decimals = 6 } = useSettlementDecimals();
  const open = data?.perps.filter((position) => position.open) ?? [];

  return (
    <Panel title={`Positions${open.length ? ` (${open.length})` : ""}`} className="h-64 shrink-0">
      <div className="min-h-0 flex-1 overflow-auto">
        {!isConnected ? (
          <p className="p-3 text-muted">Connect a wallet to see your positions.</p>
        ) : isPending ? (
          <p className="p-3 text-muted">Loading positions…</p>
        ) : open.length === 0 ? (
          <p className="p-3 text-muted">No open positions. Deposit collateral and open one from the order panel.</p>
        ) : (
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th className={head}>Market</th>
                <th className={head}>Size</th>
                <th className={head}>Leverage</th>
                <th className={head}>Margin</th>
                <th className={head}>Entry</th>
                <th className={head}>Mark</th>
                <th className={head}>Liquidation</th>
                <th className={head}>Margin ratio</th>
                <th className={head}>PnL</th>
                <th className={head}>Funding</th>
                <th className={head} />
              </tr>
            </thead>
            <tbody>
              {open.map((position) => (
                <PositionRow key={position.positionId.toString()} position={position} decimals={decimals} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}
