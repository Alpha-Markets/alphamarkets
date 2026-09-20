"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Panel, Row, TextField } from "@alphamarkets/ui";
import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { useSettlementDecimals, useVaultBalances } from "@/hooks/queries";
import { useDebounced } from "@/hooks/useDebounced";
import { useWalletAlphaMarkets } from "@/hooks/useAlphaMarkets";
import { useTx } from "@/hooks/useTx";
import { env } from "@/lib/env";
import { fmtBps, fmtPrice, fmtUsd } from "@/lib/format";
import {
  expiryCode,
  fmtQuoteDelta,
  fmtQuoteGamma,
  fmtQuoteIv,
  fmtQuotePremium,
  fmtQuoteTheta,
  fmtQuoteVega,
  ivSourceLabel,
  strikeText,
} from "@/lib/options";
import { alphaMarketsRead } from "@/lib/alphamarkets";
import { chain } from "@/lib/wagmi";
import { useOptionOrder, type OptionSelection } from "@/stores/optionOrder";
import { errorMessage } from "@/stores/tx";
import { ConnectButton } from "./ConnectButton";
import { VaultControls } from "./VaultControls";

/// A signed price is only good for a short window; refresh it well inside that.
const REFRESH_MS = 10_000;
/// Ask for a fresh signed price when the one on screen has less than this many seconds left.
const MIN_QUOTE_SECONDS = 5n;
const MAX_CONTRACTS = 1_000_000n;

const codeOf = (selection: OptionSelection) =>
  `${selection.symbol}-${expiryCode(selection.expiry)}-${strikeText(selection.strike)}-${selection.type === "CALL" ? "C" : "P"}`;

function previewArgs(selection: OptionSelection, contracts: bigint, user?: `0x${string}`) {
  return { underlying: selection.symbol, type: selection.type, strike: selection.strike, expiry: selection.expiry, contracts, user };
}

/// PROJECT_BRIEF.md Sections 26 and 45. Every figure comes from `options.previewOpen`, which also
/// returns the signed premium the chain will charge, so the ticket never computes a price itself.
/// Options are buy-only in this deployment: the Vault pool is the counterparty.
export function OptionTicket() {
  const selection = useOptionOrder((state) => state.selection);
  const { address, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const wallet = useWalletAlphaMarkets();
  const run = useTx();
  const { data: decimals = 6 } = useSettlementDecimals();
  const { data: balances } = useVaultBalances();

  const [contracts, setContracts] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string>();

  const debounced = useDebounced(contracts);
  const valid = /^[1-9]\d*$/.test(debounced) && BigInt(debounced) <= MAX_CONTRACTS;
  const settled = contracts === debounced;

  const preview = useQuery({
    queryKey: ["option-preview", selection?.symbol, String(selection?.expiry), String(selection?.strike), selection?.type, debounced, address],
    queryFn: () => alphaMarketsRead.options.previewOpen(previewArgs(selection!, BigInt(debounced), address)),
    enabled: Boolean(selection && valid && env.apiUrl),
    refetchInterval: REFRESH_MS,
    placeholderData: (previous) => previous,
    retry: false,
  });
  const p = selection && valid ? preview.data : undefined;

  const onRightChain = isConnected && chainId === chain.id;
  const problem = !onRightChain || !p
    ? undefined
    : !p.authorization
      ? "The pricing service has no signing key, so options cannot be opened. Set QUOTER_PRIVATE_KEY on services/pricing."
      : p.violations[0]
        ? errorMessage(p.violations[0])
        : p.sufficientCollateral === false
          ? "Not enough available collateral. Deposit first."
          : undefined;
  const waiting = !selection
    ? "Pick a call or put from the chain."
    : !env.apiUrl
      ? "Set NEXT_PUBLIC_API_URL to price options."
      : !valid
        ? "Enter a whole number of contracts."
        : !onRightChain
          ? undefined
          : !settled || !p
            ? "Calculating…"
            : undefined;
  const blocker = problem ?? waiting;

  async function submit() {
    if (!wallet || !selection || !p?.authorization || !address) return;
    setSubmitting(true);
    setNotice(undefined);

    // Never charge a price the person has not seen: if the signed quote is about to lapse, get a
    // new one and stop for review when the premium moved.
    let authorization = p.authorization;
    if (authorization.validUntil <= BigInt(Math.floor(Date.now() / 1000)) + MIN_QUOTE_SECONDS) {
      try {
        const fresh = await alphaMarketsRead.options.previewOpen(previewArgs(selection, BigInt(debounced), address));
        if (!fresh.authorization || fresh.premium !== p.premium) {
          setNotice(`The price changed to ${fmtUsd(fresh.premium, decimals)}. Review it and confirm again.`);
          await preview.refetch();
          setSubmitting(false);
          return;
        }
        authorization = fresh.authorization;
      } catch {
        setNotice("Could not refresh the option price. Try again.");
        setSubmitting(false);
        return;
      }
    }

    const title = `Buy ${selection.type === "CALL" ? "call" : "put"}`;
    const summary = `${codeOf(selection)} · ${debounced} contract${debounced === "1" ? "" : "s"} · premium ${fmtUsd(p.premium, decimals)}`;
    const result = await run({ title, summary }, (tx) =>
      wallet.options.openPosition({
        underlying: selection.symbol,
        type: selection.type,
        strike: selection.strike,
        expiry: selection.expiry,
        contracts: BigInt(debounced),
        authorization,
        tx,
      }),
    );
    if (result.ok) setContracts("1");
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
      variant={selection?.type === "PUT" ? "down" : "up"}
      className="w-full"
      disabled={Boolean(blocker) || submitting || !wallet}
      onClick={submit}
    >
      {submitting ? "Opening…" : selection ? `Buy ${selection.type === "CALL" ? "call" : "put"}` : "Buy"}
    </Button>
  );

  return (
    <Panel title="Option order" className="h-full overflow-y-auto">
      <VaultControls />

      <div className="flex flex-col gap-3 p-3">
        <div>
          <p className="text-xs text-muted">Series</p>
          <p className="mt-1 font-medium">{selection ? codeOf(selection) : "–"}</p>
        </div>

        <TextField
          label="Contracts"
          value={contracts}
          onValueChange={(value) => {
            setContracts(value);
            setNotice(undefined);
          }}
          placeholder="1"
          invalid={contracts !== "" && !/^[1-9]\d*$/.test(contracts)}
          hint={balances ? `Available ${fmtUsd(balances.available, decimals)}` : undefined}
        />

        {p ? (
          <dl className="border-t border-line pt-2">
            <Row label="Side">Buy {p.type === "CALL" ? "call" : "put"}</Row>
            <Row label="Contracts">{p.contracts.toString()}</Row>
            <Row label="Premium">{fmtUsd(p.premium, decimals)}</Row>
            <Row label={`Fee (${fmtBps(p.feeBps)})`}>{fmtUsd(p.fee, decimals)}</Row>
            <Row label="Total from vault" className="border-t border-line font-medium">
              {fmtUsd(p.totalRequired, decimals)}
            </Row>
            <Row label="Break-even at expiry">{fmtPrice(p.breakEven)}</Row>
            <Row label="Max loss">{fmtUsd(p.maxLoss, decimals)}</Row>
            <Row label="Max profit">{p.maxProfit === null ? "Unlimited" : fmtUsd(p.maxProfit, decimals)}</Row>
          </dl>
        ) : null}

        {p ? (
          <dl className="border-t border-line pt-2">
            <Row label="Price per unit">{fmtQuotePremium(p.quote.ask)}</Row>
            <Row label="Bid per unit">{fmtQuotePremium(p.quote.bid)}</Row>
            <Row label={`IV (${ivSourceLabel(p.quote.ivSource)})`}>{fmtQuoteIv(p.quote.iv)}</Row>
            <Row label="Delta">{fmtQuoteDelta(p.quote.delta)}</Row>
            <Row label="Gamma">{fmtQuoteGamma(p.quote.gamma)}</Row>
            <Row label="Theta per day">{fmtQuoteTheta(p.quote.theta)}</Row>
            <Row label="Vega per vol point">{fmtQuoteVega(p.quote.vega)}</Row>
          </dl>
        ) : null}

        {preview.error ? <p className="text-down">Could not price this order. Check the connection and try again.</p> : null}
        {notice ? <p className="leading-snug text-down">{notice}</p> : null}
        {problem ? <p className="leading-snug text-down">{problem}</p> : waiting ? <p className="text-muted">{waiting}</p> : null}
        {action}
      </div>
    </Panel>
  );
}
