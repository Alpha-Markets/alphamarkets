"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Panel, Row, Segmented, TextField } from "@orionis/ui";
import { toBaseUnits, type Side } from "@orionis/sdk";
import { useState } from "react";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { usePerpMarket, useSettlementDecimals, useVaultBalances } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { useWalletOrionis } from "@/hooks/useOrionis";
import { useTx } from "@/hooks/useTx";
import { fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import { orionisRead } from "@/lib/orionis";
import { chain } from "@/lib/wagmi";
import { errorMessage } from "@/stores/tx";
import { useTerminal } from "@/stores/terminal";
import { RiskLadder } from "./RiskLadder";
import { VaultControls } from "./VaultControls";

/// PROJECT_BRIEF.md Section 27. Every figure below the form comes from `perps.previewOpen`, so
/// the terminal never recomputes fees or liquidation price itself.
export function OrderPanel() {
  const symbol = useTerminal((state) => state.symbol);
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const wallet = useWalletOrionis();
  const run = useTx();
  const { data: market } = usePerpMarket(symbol);
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();

  const [side, setSide] = useState<Side>("LONG");
  const [collateral, setCollateral] = useState("");
  const [chosenLeverage, setChosenLeverage] = useState<bigint>();
  const [submitting, setSubmitting] = useState(false);

  const tiers = market?.risk.allowedLeverageTiers ?? [];
  const leverage = chosenLeverage && tiers.includes(chosenLeverage) ? chosenLeverage : tiers[0];

  const debouncedCollateral = useDebounced(collateral);
  const validAmount =
    /^\d+(\.\d+)?$/.test(debouncedCollateral) &&
    (debouncedCollateral.split(".")[1]?.length ?? 0) <= decimals &&
    Number(debouncedCollateral) > 0;

  const preview = useQuery({
    queryKey: ["preview", symbol, side, debouncedCollateral, String(leverage), address],
    queryFn: () =>
      orionisRead.perps.previewOpen({ market: symbol, side, collateral: debouncedCollateral, leverage: Number(leverage), user: address }),
    enabled: Boolean(symbol && leverage && validAmount),
    refetchInterval: 4_000,
    placeholderData: (previous) => previous,
  });
  const p = validAmount ? preview.data : undefined;

  // `problem` is something the person must fix; `waiting` just explains why the button is idle.
  const problem =
    !isConnected || chainId !== chain.id || !validAmount || !p
      ? undefined
      : p.violations[0]
        ? errorMessage(p.violations[0])
        : p.sufficientCollateral === false
          ? "Not enough available collateral. Deposit first."
          : undefined;
  const waiting = !isConnected || chainId !== chain.id ? undefined : !validAmount ? "Enter a collateral amount." : !p ? "Calculating…" : undefined;
  const blocker = problem ?? waiting;

  async function submit() {
    if (!wallet || !leverage || !p) return;
    setSubmitting(true);
    const title = side === "LONG" ? "Open long" : "Open short";
    const summary = `${symbol}-PERP · ${side === "LONG" ? "Long" : "Short"} · ${fmtUsd(p.notional, decimals, 0)} · ${leverage}x`;
    const result = await run({ title, summary }, (tx) =>
      wallet.perps.openPosition({ market: symbol, side, collateral: toBaseUnits(debouncedCollateral, decimals), leverage, tx }),
    );
    if (result.ok) setCollateral("");
    setSubmitting(false);
  }

  const action = !isConnected ? (
    <Button variant="primary" className="w-full" disabled={!connectors[0]} onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
      Connect wallet
    </Button>
  ) : chainId !== chain.id ? (
    <Button variant="down" className="w-full" onClick={() => switchChain({ chainId: chain.id })}>
      Switch to {chain.name}
    </Button>
  ) : (
    <Button
      variant={side === "LONG" ? "up" : "down"}
      className="w-full"
      disabled={Boolean(blocker) || submitting || !wallet}
      onClick={submit}
    >
      {submitting ? "Opening…" : side === "LONG" ? "Open long" : "Open short"}
    </Button>
  );

  return (
    <Panel title="Order" className="h-full overflow-y-auto">
      <VaultControls />

      <div className="flex flex-col gap-3 p-3">
        <Segmented
          label="Side"
          value={side}
          onChange={setSide}
          activeTone={(value) => (value === "LONG" ? "up" : "down")}
          options={[
            { value: "LONG", label: "Long" },
            { value: "SHORT", label: "Short" },
          ]}
        />
        <Segmented
          label="Order type"
          value="MARKET"
          onChange={() => undefined}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit", disabled: true },
          ]}
        />

        <TextField
          label="Collateral"
          value={collateral}
          onValueChange={setCollateral}
          suffix="USD"
          placeholder="0.00"
          hint={balances ? `Available ${fmtUsd(balances.available, decimals)}` : undefined}
        />

        <div>
          <p className="mb-1 text-xs text-muted">Leverage</p>
          {tiers.length === 0 ? (
            <p className="text-muted">–</p>
          ) : (
            <Segmented
              label="Leverage"
              value={Number(leverage)}
              onChange={(value) => setChosenLeverage(BigInt(value))}
              options={tiers.map((tier) => ({ value: Number(tier), label: `${tier}x` }))}
            />
          )}
        </div>

        {p ? (
          <>
            <RiskLadder isLong={side === "LONG"} entry={p.entryPrice} liquidation={p.liquidationPrice} worst={p.worstPrice} />
            <dl className="border-t border-line pt-2">
              <Row label="Side">{side === "LONG" ? "Long" : "Short"}</Row>
              <Row label="Size">{fmtUsd(p.notional, decimals)}</Row>
              <Row label="Leverage">{`${p.leverage}x`}</Row>
              <Row label="Estimated entry">{fmtPrice(p.entryPrice)}</Row>
              <Row label="Worst accepted price">{fmtPrice(p.worstPrice)}</Row>
              <Row label="Margin">{fmtUsd(p.collateral, decimals)}</Row>
              <Row label="Liquidation price">{fmtPrice(p.liquidationPrice)}</Row>
              <Row label="Funding rate">{fmtBps(p.fundingRateBps)}</Row>
              <Row label={`Fee (${fmtBps(p.feeBps)})`}>{fmtUsd(p.fee, decimals)}</Row>
              <Row label="Total from vault" className="border-t border-line font-medium">
                {fmtUsd(p.totalRequired, decimals)}
              </Row>
            </dl>
          </>
        ) : null}

        {preview.error ? <p className="text-down">Could not price this order. Check the connection and try again.</p> : null}
        {problem ? <p className="leading-snug text-down">{problem}</p> : waiting ? <p className="text-muted">{waiting}</p> : null}
        {action}
      </div>
    </Panel>
  );
}
