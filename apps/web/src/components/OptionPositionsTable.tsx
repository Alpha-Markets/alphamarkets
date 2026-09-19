"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Num } from "@orionis/ui";
import { margin, OptionPositionStatus, OptionType, premiumForOrder, type CloseQuote } from "@orionis/sdk";
import type { OptionPosition } from "@orionis/types";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useSettlementDecimals } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { useWalletOrionis } from "@/hooks/useOrionis";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtSigned, fmtUsd, signTone } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { optionCodeOf } from "@/lib/options";
import { orionisRead } from "@/lib/orionis";

const head = "px-3 py-2 text-right text-xs font-normal text-muted first:text-left";
const cell = "px-3 py-2 text-right tabular-nums first:text-left";

const statusLabel: Record<OptionPositionStatus, string> = {
  [OptionPositionStatus.OPEN]: "Open",
  [OptionPositionStatus.CLOSED]: "Closed",
  [OptionPositionStatus.SETTLED]: "Settled",
};

function OptionRow({ position, decimals }: { position: OptionPosition; decimals: number }) {
  const { address } = useAccount();
  const wallet = useWalletOrionis();
  const run = useTx();
  const now = useNow();
  const symbol = symbolOf(position.marketId);
  const type = position.optionType === OptionType.CALL ? "CALL" : "PUT";
  const isOpen = position.status === OptionPositionStatus.OPEN;
  const expired = now > 0 && BigInt(Math.floor(now / 1000)) >= position.expiry;

  // Mark premium is an offchain quote (PROJECT_BRIEF.md Section 10), so it needs the API and is
  // display-only — closing uses a separately signed price.
  const mark = useQuery({
    queryKey: ["option-mark", position.positionId.toString()],
    enabled: Boolean(env.apiUrl && isOpen && !expired && now > 0),
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () => {
      const [quote, contractSize] = await Promise.all([
        orionisRead.options.quote({ underlying: symbol, type, strike: position.strike, expiry: position.expiry, contracts: position.contracts }),
        orionisRead.options.contractSize(symbol),
      ]);
      return premiumForOrder(quote.premium, contractSize, position.contracts, decimals);
    },
  });
  const unrealized = mark.data === undefined ? undefined : mark.data - position.entryPremium;

  const [confirm, setConfirm] = useState<{ quote: CloseQuote; fee: bigint }>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function requestClose() {
    if (!address) return;
    setBusy(true);
    setProblem(undefined);
    try {
      const [quote, fees] = await Promise.all([orionisRead.options.quoteClose(position.positionId, address), orionisRead.fees.get(symbol)]);
      setConfirm({ quote, fee: margin.feeFromBps(quote.premium, fees.optionCloseFee) });
    } catch (error) {
      setProblem(error instanceof Error && error.message.includes("apiUrl") ? "Closing needs NEXT_PUBLIC_API_URL." : "Could not get a closing price. Try again.");
    }
    setBusy(false);
  }

  async function submitClose() {
    if (!wallet || !confirm) return;
    setBusy(true);
    const code = optionCodeOf(position);
    const result = await run({ title: "Close option", summary: `${code} · ${position.contracts} contracts` }, (tx) =>
      wallet.options.closePosition(position.positionId, { authorization: confirm.quote.authorization, tx }),
    );
    if (result.ok) setConfirm(undefined);
    setBusy(false);
  }

  async function settle() {
    if (!wallet) return;
    setBusy(true);
    await run({ title: "Settle option", summary: optionCodeOf(position) }, (tx) =>
      wallet.options.settle(symbol, position.expiry, position.strike, type, tx),
    );
    setBusy(false);
  }

  return (
    <tr className="border-t border-line align-top">
      <td className={cell}>
        <span className="font-medium">{optionCodeOf(position)}</span>
      </td>
      <td className={cell}>{position.contracts.toString()}</td>
      <td className={cell}>{fmtUsd(position.entryPremium, decimals)}</td>
      <td className={cell}>{isOpen && !expired ? fmtUsd(mark.data, decimals) : "–"}</td>
      <td className={cell}>{fmtUsd(position.collateral, decimals)}</td>
      <td className={cell}>
        <Num tone={signTone(unrealized, decimals)}>{isOpen && !expired ? fmtSigned(unrealized, decimals) : "–"}</Num>
      </td>
      <td className={cell}>
        <Num tone={signTone(position.realizedPnl, decimals)}>{isOpen ? "–" : fmtSigned(position.realizedPnl, decimals)}</Num>
      </td>
      <td className={cell}>{isOpen && expired ? "Expired" : statusLabel[position.status]}</td>
      <td className="px-3 py-2 text-right">
        {!isOpen ? null : expired ? (
          <Button size="sm" disabled={!wallet || busy} onClick={settle}>
            Settle
          </Button>
        ) : confirm ? (
          <div className="flex flex-col items-end gap-1">
            <span className="tabular-nums">
              Receive {fmtUsd(confirm.quote.premium, decimals)}
              <span className="text-muted"> less {fmtUsd(confirm.fee, decimals)} fee</span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="primary" disabled={busy || !wallet} onClick={submitClose}>
                Confirm close
              </Button>
              <Button size="sm" disabled={busy} onClick={() => setConfirm(undefined)}>
                Cancel
              </Button>
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" disabled={!wallet || busy} onClick={requestClose}>
              {busy ? "Pricing…" : "Close"}
            </Button>
            {problem ? <span className="text-xs text-down">{problem}</span> : null}
          </div>
        )}
      </td>
    </tr>
  );
}

export function OptionPositionsTable({ positions }: { positions: OptionPosition[] }) {
  const { data: decimals = 6 } = useSettlementDecimals();
  return (
    <table className="w-full min-w-[900px] text-sm">
      <thead>
        <tr>
          <th className={head}>Option</th>
          <th className={head}>Contracts</th>
          <th className={head}>Entry premium</th>
          <th className={head}>Mark premium</th>
          <th className={head}>Collateral</th>
          <th className={head}>Unrealized PnL</th>
          <th className={head}>Realized PnL</th>
          <th className={head}>Status</th>
          <th className={head} />
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => (
          <OptionRow key={position.positionId.toString()} position={position} decimals={decimals} />
        ))}
      </tbody>
    </table>
  );
}

