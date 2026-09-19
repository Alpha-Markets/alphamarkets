"use client";

import { Num, Panel, Segmented, cn } from "@orionis/ui";
import type { OptionSide, OptionsQuoteResult } from "@orionis/sdk";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useIndexPrice, useListedExpiries, useOptionChain, useOptionUnderlyings } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { env } from "@/lib/env";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import {
  expiryCode,
  expiryDates,
  fmtQuoteDelta,
  fmtQuoteIv,
  fmtQuotePremium,
  nearestStrikeIndex,
  strikeLadder,
  strikeText,
} from "@/lib/options";
import { useOptionOrder } from "@/stores/optionOrder";
import { useTerminal } from "@/stores/terminal";

const head = "px-3 py-2 text-right text-xs font-normal text-muted";
const cell = "px-3 py-1.5 text-right tabular-nums";

type Quote = UseQueryResult<OptionsQuoteResult, Error>;

/// Three columns for one side of the chain. Only the premium is a button; picking it fills the
/// order ticket. Premium, IV and delta are the pricing service's display analytics, not a price
/// anyone is charged: the ticket asks for a signed quote before an order.
function SideCells({
  side,
  quote,
  selected,
  onSelect,
}: {
  side: OptionSide;
  quote: Quote;
  selected: boolean;
  onSelect: () => void;
}) {
  const data = quote.data;
  // "…" while the first quote loads, "–" when the pricing service could not answer.
  const text = (value: string | undefined) => value ?? (quote.isError ? "–" : "…");
  const mark = (
    <td className={cn(cell, selected && "bg-raised")}>
      <button
        type="button"
        disabled={!data}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={side === "CALL" ? "Buy call" : "Buy put"}
        className="font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline"
      >
        {text(data && fmtQuotePremium(data.premium))}
      </button>
    </td>
  );
  const iv = <td className={cn(cell, "text-muted", selected && "bg-raised")}>{text(data && fmtQuoteIv(data.iv))}</td>;
  const delta = <td className={cn(cell, "text-muted", selected && "bg-raised")}>{text(data && fmtQuoteDelta(data.delta))}</td>;
  return side === "CALL" ? (
    <>
      {delta}
      {iv}
      {mark}
    </>
  ) : (
    <>
      {mark}
      {iv}
      {delta}
    </>
  );
}

/// PROJECT_BRIEF.md Sections 25-26: underlying and expiry selectors above a chain with calls on the
/// left, strikes in the centre and puts on the right. The contract lists no strikes, so the ladder
/// is proposed around the index price from `env.options`.
export function OptionChain() {
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const selection = useOptionOrder((state) => state.selection);
  const select = useOptionOrder((state) => state.select);
  const now = useNow();

  const { data: underlyings, isPending: loadingMarkets, error: marketsError } = useOptionUnderlyings();
  const symbols = useMemo(
    () => underlyings?.map((market) => symbolOf(market.marketId)) ?? [],
    [underlyings],
  );
  // The shared selection may hold a perp-only market; fall back to the first with options.
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(symbol)) setSymbol(symbols[0]!);
  }, [symbols, symbol, setSymbol]);
  // A series picked for another underlying no longer applies.
  useEffect(() => {
    if (selection && selection.symbol !== symbol) select(undefined);
  }, [symbol, selection, select]);

  const { data: spot } = useIndexPrice(symbol);
  const { data: listed } = useListedExpiries(symbol);

  const minute = Math.floor(now / 60_000);
  const expiries = useMemo(
    () => (now > 0 ? expiryDates(env.options.expiryDays, BigInt(Math.floor(now / 1000)), env.options.expiryHourUtc, listed ?? []) : []),
    // Recomputed once a minute, not on every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minute, listed],
  );
  const [chosenExpiry, setChosenExpiry] = useState<string>();
  const expiry = expiries.find((value) => value.toString() === chosenExpiry) ?? expiries[0];

  const strikes = useMemo(
    () => (spot ? strikeLadder(spot, env.options.strikeStepBps, env.options.strikeRows) : []),
    [spot],
  );
  const rows = useOptionChain(symbol, expiry, strikes);
  const atTheMoney = spot ? nearestStrikeIndex(strikes, spot) : -1;

  return (
    <Panel
      title={
        <div className="flex items-center gap-3">
          <span>Option chain</span>
          {spot ? <span className="text-xs font-normal text-muted">Index {fmtPrice(spot)}</span> : null}
        </div>
      }
      className="min-h-0 flex-1"
    >
      <div className="flex flex-wrap items-end gap-4 border-b border-line p-3">
        <div>
          <p className="mb-1 text-xs text-muted">Underlying</p>
          {symbols.length === 0 ? (
            <p className="h-8 text-muted">{loadingMarkets ? "Loading…" : "None"}</p>
          ) : (
            <Segmented
              label="Underlying"
              value={symbol}
              onChange={setSymbol}
              options={symbols.map((value) => ({ value, label: value }))}
            />
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Expiry</p>
          {expiries.length === 0 ? (
            <p className="h-8 text-muted">–</p>
          ) : (
            <Segmented
              label="Expiry"
              value={expiry!.toString()}
              onChange={setChosenExpiry}
              options={expiries.map((value) => ({ value: value.toString(), label: expiryCode(value) }))}
            />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {marketsError ? (
          <p className="p-3 text-down">Could not read markets from the chain. Check NEXT_PUBLIC_RPC_URL.</p>
        ) : !env.apiUrl ? (
          <p className="p-3 text-muted">Option prices come from the pricing service. Set NEXT_PUBLIC_API_URL and start services/api and services/pricing to load the chain.</p>
        ) : symbols.length === 0 && !loadingMarkets ? (
          <p className="p-3 text-muted">No market on the registry has options enabled yet.</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-muted">Waiting for the index price…</p>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr>
                <th className={cn(head, "text-center")} colSpan={3}>
                  Calls
                </th>
                <th className={cn(head, "text-center")}>Strike</th>
                <th className={cn(head, "text-center")} colSpan={3}>
                  Puts
                </th>
              </tr>
              <tr>
                <th className={head}>Delta</th>
                <th className={head}>IV</th>
                <th className={head}>Mark</th>
                <th className={cn(head, "text-center")}>Price</th>
                <th className={head}>Mark</th>
                <th className={head}>IV</th>
                <th className={head}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const isPick = (type: OptionSide) =>
                  selection?.symbol === symbol &&
                  selection.expiry === expiry &&
                  selection.strike === row.strike &&
                  selection.type === type;
                return (
                  <tr key={row.strike.toString()} className={cn("border-t border-line", index === atTheMoney && "bg-surface")}>
                    <SideCells
                      side="CALL"
                      quote={row.call}
                      selected={isPick("CALL")}
                      onSelect={() => expiry && select({ symbol, expiry, strike: row.strike, type: "CALL" })}
                    />
                    <td className={cn(cell, "text-center font-medium")}>
                      <Num>{strikeText(row.strike)}</Num>
                    </td>
                    <SideCells
                      side="PUT"
                      quote={row.put}
                      selected={isPick("PUT")}
                      onSelect={() => expiry && select({ symbol, expiry, strike: row.strike, type: "PUT" })}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="border-t border-line px-3 py-2 text-xs text-muted">
        Premiums are per underlying unit and shown for reference; the order ticket signs the price you pay. Strikes are a
        suggested ladder around the index price. Bid/ask, open interest and volume are not available yet.
      </p>
    </Panel>
  );
}
