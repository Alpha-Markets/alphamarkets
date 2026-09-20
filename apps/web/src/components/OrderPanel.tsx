"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Panel, Row, Segmented, TextField } from "@orionis/ui";
import { toBaseUnits, type OrderType } from "@orionis/sdk";
import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { usePerpMarket, useSettlementDecimals, useVaultBalances } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { useWalletOrionis } from "@/hooks/useOrionis";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import { LIMIT_EXPIRIES, limitDirectionNote, limitExpirySeconds, parseLimitPrice, type LimitExpiry } from "@/lib/limit";
import { orionisRead } from "@/lib/orionis";
import { chain } from "@/lib/wagmi";
import { errorMessage } from "@/stores/tx";
import { useTerminal } from "@/stores/terminal";
import { ConnectButton } from "./ConnectButton";
import { RiskLadder } from "./RiskLadder";
import { VaultControls } from "./VaultControls";

/// PROJECT_BRIEF.md Section 27. Every figure below the form comes from `perps.previewOpen`, so
/// the terminal never recomputes fees or liquidation price itself.
export function OrderPanel() {
  const symbol = useTerminal((state) => state.symbol);
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const wallet = useWalletOrionis();
  const run = useTx();
  const { data: market } = usePerpMarket(symbol);
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();

  const side = useTerminal((state) => state.side);
  const setSide = useTerminal((state) => state.setSide);
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [marginMode, setMarginMode] = useState<"ISOLATED" | "CROSS">("ISOLATED");
  const [limitPrice, setLimitPrice] = useState("");
  const [expiry, setExpiry] = useState<LimitExpiry>("24h");
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

  const isLimit = orderType === "LIMIT";
  /// A limit order fills later through the keeper, which opens an isolated position, so cross margin
  /// applies to market orders only.
  const useCross = marginMode === "CROSS" && env.crossMargin && !isLimit;
  const debouncedLimit = useDebounced(limitPrice);
  const trigger = parseLimitPrice(debouncedLimit);
  const validLimit = !isLimit || trigger !== undefined;

  const preview = useQuery({
    queryKey: ["preview", symbol, side, orderType, isLimit ? debouncedLimit : "", debouncedCollateral, String(leverage), address],
    queryFn: () =>
      orionisRead.perps.previewOpen({
        market: symbol,
        side,
        collateral: debouncedCollateral,
        leverage: Number(leverage),
        user: address,
        ...(isLimit ? { orderType, limitPrice: trigger } : {}),
      }),
    enabled: Boolean(symbol && leverage && validAmount && validLimit),
    refetchInterval: 4_000,
    placeholderData: (previous) => previous,
  });
  const p = validAmount && validLimit ? preview.data : undefined;

  // `problem` is something the person must fix; `waiting` just explains why the button is idle.
  const problem =
    !isConnected || chainId !== chain.id || !validAmount || !p
      ? undefined
      : p.violations[0]
        ? errorMessage(p.violations[0])
        : p.sufficientCollateral === false
          ? "Not enough available collateral. Deposit first."
          : undefined;
  const waiting =
    !isConnected || chainId !== chain.id
      ? undefined
      : !validAmount
        ? "Enter a collateral amount."
        : !validLimit
          ? "Enter a limit price."
          : !p
            ? "Calculating…"
            : undefined;
  const blocker = problem ?? waiting;

  async function submit() {
    if (!wallet || !leverage || !p) return;
    setSubmitting(true);
    const direction = side === "LONG" ? "long" : "short";
    const summary = `${symbol}-PERP · ${side === "LONG" ? "Long" : "Short"} · ${fmtUsd(p.notional, decimals, 0)} · ${leverage}x`;
    const result = isLimit
      ? await run({ title: `Place limit ${direction}`, summary: `${summary} · at ${fmtPrice(p.entryPrice)}` }, (tx) =>
          wallet.perps.placeLimitOrder({
            market: symbol,
            side,
            collateral: toBaseUnits(debouncedCollateral, decimals),
            leverage,
            limitPrice: p.entryPrice,
            expiry: BigInt(Math.floor(Date.now() / 1000) + limitExpirySeconds(expiry)),
            tx,
          }),
        )
      : await run({ title: `Open ${direction}`, summary }, (tx) =>
          wallet.perps.openPosition({
            market: symbol,
            side,
            collateral: toBaseUnits(debouncedCollateral, decimals),
            leverage,
            ...(useCross ? { marginMode: "CROSS" as const } : {}),
            tx,
          }),
        );
    if (result.ok) {
      setCollateral("");
      setLimitPrice("");
    }
    setSubmitting(false);
  }

  const action = !isConnected ? (
    <ConnectButton className="w-full" />
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
      {submitting
        ? isLimit
          ? "Placing…"
          : "Opening…"
        : `${isLimit ? "Place limit" : "Open"} ${side === "LONG" ? "long" : "short"}`}
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
          value={orderType}
          onChange={setOrderType}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit", disabled: !env.limitOrders },
          ]}
        />
        {env.crossMargin ? (
          <Segmented
            label="Margin mode"
            value={marginMode}
            onChange={setMarginMode}
            options={[
              { value: "ISOLATED", label: "Isolated" },
              { value: "CROSS", label: "Cross", disabled: isLimit },
            ]}
          />
        ) : null}
        {useCross ? (
          <p className="text-xs leading-snug text-muted">
            Cross: this position is backed by your whole account, not only its own margin. It is liquidated when the account&apos;s equity falls under its requirement, and withdrawals that would leave it too thin are refused.
          </p>
        ) : null}
        {env.limitOrders ? null : (
          <p className="text-xs leading-snug text-muted">Limit orders need the latest contracts, which are not deployed on this network yet.</p>
        )}

        {isLimit ? (
          <>
            <TextField
              label="Limit price"
              value={limitPrice}
              onValueChange={setLimitPrice}
              suffix="USD"
              placeholder={market ? fmtPrice(market.markPrice).replace(/,/g, "") : "0.00"}
              invalid={limitPrice !== "" && trigger === undefined}
              hint={
                market
                  ? (limitDirectionNote(side === "LONG", trigger, market.markPrice) ??
                    `${side === "LONG" ? "Fills at or below" : "Fills at or above"} this price. Mark ${fmtPrice(market.markPrice)}.`)
                  : undefined
              }
            />
            <div>
              <p className="mb-1 text-xs text-muted">Expires in</p>
              <Segmented
                label="Expiry"
                value={expiry}
                onChange={setExpiry}
                options={LIMIT_EXPIRIES.map((value) => ({ value, label: value }))}
              />
            </div>
          </>
        ) : null}

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
              {isLimit ? (
                <Row label={side === "LONG" ? "Fills at or below" : "Fills at or above"}>{fmtPrice(p.entryPrice)}</Row>
              ) : (
                <>
                  <Row label="Estimated entry">{fmtPrice(p.entryPrice)}</Row>
                  <Row label="Worst accepted price">{fmtPrice(p.worstPrice)}</Row>
                </>
              )}
              <Row label="Margin">{fmtUsd(p.collateral, decimals)}</Row>
              <Row label="Liquidation price">{fmtPrice(p.liquidationPrice)}</Row>
              <Row label="Funding rate">{fmtBps(p.fundingRateBps)}</Row>
              <Row label={`Fee (${fmtBps(p.feeBps)})`}>{fmtUsd(p.fee, decimals)}</Row>
              <Row label={isLimit ? "Needed when it fills" : "Total from vault"} className="border-t border-line font-medium">
                {fmtUsd(p.totalRequired, decimals)}
              </Row>
            </dl>
            {isLimit ? (
              <p className="text-xs leading-snug text-muted">
                Nothing is reserved while the order waits. The margin and fee are taken from your vault balance when it fills, so keep
                that balance available. Cancel it any time from Portfolio.
              </p>
            ) : null}
          </>
        ) : null}

        {preview.error ? <p className="text-down">Could not price this order. Check the connection and try again.</p> : null}
        {problem ? <p className="leading-snug text-down">{problem}</p> : waiting ? <p className="text-muted">{waiting}</p> : null}
        {action}
      </div>
    </Panel>
  );
}
