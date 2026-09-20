"use client";

import { Button, Row, Skeleton, TextField } from "@alphamarkets/ui";
import { toBaseUnits } from "@alphamarkets/sdk";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useSettlementDecimals, useVaultBalances, useWalletTokenBalance } from "@/hooks/queries";
import { useWalletAlphaMarkets } from "@/hooks/useAlphaMarkets";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtUsd } from "@/lib/format";

type Mode = "deposit" | "withdraw" | undefined;

/// Collateral has to be in the Vault before any order (PROJECT_BRIEF.md Section 7), so deposit
/// and withdraw sit directly above the order form.
export function VaultControls() {
  const { address, isConnected } = useAccount();
  const wallet = useWalletAlphaMarkets();
  const run = useTx();
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();
  const { data: walletBalance } = useWalletTokenBalance();
  const [mode, setMode] = useState<Mode>();
  const [manual, setManual] = useState<boolean>();
  // Trading needs collateral in the Vault, so an empty Vault opens this block; otherwise it stays
  // to one line and leaves the room to the order form.
  const expanded = manual ?? (isConnected && balances?.available === 0n);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const valid = /^\d+(\.\d+)?$/.test(amount) && (amount.split(".")[1]?.length ?? 0) <= decimals && Number(amount) > 0;
  const base = valid ? toBaseUnits(amount, decimals) : 0n;
  const limit = mode === "deposit" ? walletBalance : balances?.available;
  const tooMuch = limit !== undefined && base > limit;

  async function submit() {
    if (!wallet || !mode || !valid) return;
    setBusy(true);
    const { settlementToken, vault } = env.addresses;

    if (mode === "deposit") {
      const allowance = address ? await wallet.erc20.allowance(settlementToken, address, vault) : 0n;
      if (allowance < base) {
        const approved = await run({ title: "Approve collateral" }, (tx) => wallet.erc20.approve(settlementToken, vault, base, tx));
        if (!approved.ok) return setBusy(false);
      }
      await run({ title: "Deposit", summary: fmtUsd(base, decimals) }, (tx) => wallet.vault.deposit(settlementToken, base, tx));
    } else {
      await run({ title: "Withdraw", summary: fmtUsd(base, decimals) }, (tx) => wallet.vault.withdraw(settlementToken, base, tx));
    }
    setAmount("");
    setMode(undefined);
    setBusy(false);
  }

  return (
    <div className="border-b border-line">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
        className="flex h-11 w-full items-center justify-between gap-3 px-3 text-left hover:bg-raised"
      >
        <span className="text-muted">Available collateral</span>
        <span className="flex items-center gap-2">
          <span className="tabular-nums">
            {balances ? fmtUsd(balances.available, decimals) : isConnected ? <Skeleton className="w-16" /> : "–"}
          </span>
          <span className="text-xs text-muted">{expanded ? "Hide" : "Manage"}</span>
        </span>
      </button>

      {expanded ? (
        <div className="px-3 pb-3">
          <dl>
            <Row label="Locked margin">{fmtUsd(balances?.lockedMargin, decimals)}</Row>
            <Row label="Wallet balance">{fmtUsd(walletBalance, decimals)}</Row>
          </dl>

          {mode ? (
            <div className="mt-3 flex flex-col gap-2">
              <TextField
                label={mode === "deposit" ? "Deposit amount" : "Withdraw amount"}
                value={amount}
                onValueChange={setAmount}
                suffix="USD"
                placeholder="0.00"
                invalid={tooMuch}
                hint={tooMuch ? "More than you have" : undefined}
              />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" className="flex-1" disabled={!valid || tooMuch || busy} onClick={submit}>
                  {busy ? "Working…" : mode === "deposit" ? "Deposit" : "Withdraw"}
                </Button>
                <Button size="sm" disabled={busy} onClick={() => setMode(undefined)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="flex-1" disabled={!isConnected} onClick={() => setMode("deposit")}>
                Deposit
              </Button>
              <Button size="sm" className="flex-1" disabled={!isConnected} onClick={() => setMode("withdraw")}>
                Withdraw
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
