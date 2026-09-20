"use client";

import { Num, Panel, Segmented, cn } from "@orionis/ui";
import type { OptionSeriesStats, OptionSide, OptionsQuoteResult } from "@orionis/sdk";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useIndexPrice, useListedExpiries, useOptionChain, useOptionStats, useOptionUnderlyings } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { env } from "@/lib/env";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import {
  expiryCode,
  expiryDates,
  fmtContracts,
  fmtQuoteDelta,
  fmtQuoteGamma,
  fmtQuoteIv,
  fmtQuotePremium,
  fmtQuoteTheta,
  fmtQuoteVega,
  nearestStrikeIndex,
  seriesKey,
  strikeLadder,
  strikeText,
} from "@/lib/options";
import { useOptionOrder } from "@/stores/optionOrder";
import { useTerminal } from "@/stores/terminal";

const head = "px-3 py-2 text-right text-xs font-normal text-muted";
/// A header cell that spans a group of columns and centres over them.
const groupHead = "px-3 py-2 text-center text-xs font-normal text-muted";
const cell = "px-3 py-1.5 text-right tabular-nums";

type Quote = UseQueryResult<OptionsQuoteResult, Error>;
type Stats = UseQueryResult<Map<string, OptionSeriesStats>, Error>;
type View = "market" | "greeks";

interface CellContext {
  side: OptionSide;
  quote: Quote;
  stats: Stats;
  strike: bigint;
  selected: boolean;
  onSelect: () => void;
}

interface Column {
  id: string;
  header: string;
  /// The cell's contents. Numbers here are the pricing service's display analytics or the
  /// indexer's counts, never the price an order is charged: the ticket signs that.
  render: (context: CellContext) => ReactNode;
  muted?: boolean;
}

/// "…" while the first answer loads, "–" when the service could not give one.
function quoted(quote: Quote, format: (data: OptionsQuoteResult) => string): string {
  return quote.data ? format(quote.data) : quote.isError ? "–" : "…";
}

/// Open interest and volume come from the indexer. A series nobody has traded is not in its answer,
/// which means zero, not "unknown".
function counted(stats: Stats, context: CellContext, pick: (row: OptionSeriesStats) => bigint): string {
  if (!env.apiUrl || stats.isError) return "–";
  if (!stats.data) return "…";
  const row = stats.data.get(seriesKey(context.strike, context.side));
  return fmtContracts(row ? pick(row) : 0n);
}

/// The ask is the only selectable cell: it is the price opening pays, and picking it fills the
/// order ticket. Everything else in the chain is reference.
const askColumn: Column = {
  id: "ask",
  header: "Ask",
  render: ({ quote, side, selected, onSelect }) => (
    <button
      type="button"
      disabled={!quote.data}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={side === "CALL" ? "Buy call" : "Buy put"}
      className="font-medium underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:no-underline"
    >
      {quoted(quote, (data) => fmtQuotePremium(data.ask))}
    </button>
  ),
};

/// Columns for one side, listed from the strike outwards; the calls side is mirrored so both sides
/// read away from the strike the same way.
const columnsByView: Record<View, Column[]> = {
  market: [
    askColumn,
    { id: "bid", header: "Bid", render: ({ quote }) => quoted(quote, (data) => fmtQuotePremium(data.bid)) },
    { id: "iv", header: "IV", muted: true, render: ({ quote }) => quoted(quote, (data) => fmtQuoteIv(data.iv)) },
    { id: "oi", header: "Open int.", muted: true, render: (context) => counted(context.stats, context, (row) => row.openInterest) },
    { id: "vol", header: "Vol 24h", muted: true, render: (context) => counted(context.stats, context, (row) => row.volume24h) },
  ],
  greeks: [
    askColumn,
    { id: "delta", header: "Delta", muted: true, render: ({ quote }) => quoted(quote, (data) => fmtQuoteDelta(data.delta)) },
    { id: "gamma", header: "Gamma", muted: true, render: ({ quote }) => quoted(quote, (data) => fmtQuoteGamma(data.gamma)) },
    { id: "theta", header: "Theta/day", muted: true, render: ({ quote }) => quoted(quote, (data) => fmtQuoteTheta(data.theta)) },
    { id: "vega", header: "Vega/pt", muted: true, render: ({ quote }) => quoted(quote, (data) => fmtQuoteVega(data.vega)) },
  ],
};

function orderedColumns(view: View, side: OptionSide): Column[] {
  const columns = columnsByView[view];
  return side === "CALL" ? [...columns].reverse() : columns;
}

function SideCells({ view, ...context }: CellContext & { view: View }) {
  return (
    <>
      {orderedColumns(view, context.side).map((column) => (
        <td key={column.id} className={cn(cell, column.muted && "text-muted", context.selected && "bg-raised")}>
          {column.render(context)}
        </td>
      ))}
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
  const stats = useOptionStats(symbol, expiry);
  const [view, setView] = useState<View>("market");
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
        <div>
          <p className="mb-1 text-xs text-muted">Columns</p>
          <Segmented
            label="Columns"
            value={view}
            onChange={setView}
            options={[
              { value: "market", label: "Market" },
              { value: "greeks", label: "Greeks" },
            ]}
          />
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
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr>
                <th className={groupHead} colSpan={5}>
                  Calls
                </th>
                <th className={groupHead}>Strike</th>
                <th className={groupHead} colSpan={5}>
                  Puts
                </th>
              </tr>
              <tr>
                {orderedColumns(view, "CALL").map((column) => (
                  <th key={`c-${column.id}`} className={head}>
                    {column.header}
                  </th>
                ))}
                <th className={groupHead}>Price</th>
                {orderedColumns(view, "PUT").map((column) => (
                  <th key={`p-${column.id}`} className={head}>
                    {column.header}
                  </th>
                ))}
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
                      view={view}
                      side="CALL"
                      quote={row.call}
                      stats={stats}
                      strike={row.strike}
                      selected={isPick("CALL")}
                      onSelect={() => expiry && select({ symbol, expiry, strike: row.strike, type: "CALL" })}
                    />
                    <td className={cn(cell, "text-center font-medium")}>
                      <Num>{strikeText(row.strike)}</Num>
                    </td>
                    <SideCells
                      view={view}
                      side="PUT"
                      quote={row.put}
                      stats={stats}
                      strike={row.strike}
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
        Prices are per underlying unit. Ask is what opening pays and bid is what closing receives; the order ticket signs the
        price you pay. Open interest and volume count contracts. IV is the volatility the model prices with, not one implied by
        trading. Strikes are a suggested ladder around the index price.
      </p>
    </Panel>
  );
}
