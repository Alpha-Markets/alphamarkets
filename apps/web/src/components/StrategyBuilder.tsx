"use client";

import { Num, Panel, Segmented, Stat, TextField } from "@orionis/ui";
import { analyzeStrategy, payoffCurve, strategyLegs, STRATEGY_KINDS, type Leg, type OptionQuote, type StrategyKind } from "@orionis/sdk";
import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useIndexPrice, useListedExpiries, useOptionChain, useOptionUnderlyings } from "@/hooks/queries";
import { useNow } from "@/hooks/useNow";
import { env } from "@/lib/env";
import { symbolOf } from "@/lib/market";
import { expiryCode, expiryDates, nearestStrikeIndex, strikeLadder } from "@/lib/options";
import {
  chartRange,
  defaultStrikeValues,
  fmtLimit,
  fmtNet,
  fmtSignedUsd,
  strikesFromValues,
  STRATEGY_FIELDS,
  STRATEGY_LABEL,
  STRATEGY_SUMMARY,
} from "@/lib/strategies";
import { useTerminal } from "@/stores/terminal";

const toNumber = (value: bigint) => Number(formatUnits(value, 18));
const selectClass = "h-8 rounded-[3px] border border-line bg-surface px-2 text-sm text-text";

/// A payoff-at-expiry line chart. Green above zero, red below, with the price and break-evens on
/// the axis. Drawn as plain SVG: it is a display of the analysis, nothing here is signed.
function PayoffChart({ legs, low, high, spot, breakEvens }: { legs: Leg[]; low: number; high: number; spot: number; breakEvens: number[] }) {
  const width = 640;
  const height = 220;
  const pad = 28;
  const curve = payoffCurve(legs, low, high, 121);
  const values = curve.map(([, value]) => value);
  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  const span = top - bottom || 1;
  const x = (price: number) => pad + ((price - low) / (high - low)) * (width - 2 * pad);
  const y = (value: number) => pad + ((top - value) / span) * (height - 2 * pad);
  const path = curve.map(([price, value], index) => `${index === 0 ? "M" : "L"}${x(price).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Payoff at expiry" className="w-full max-w-[720px]">
      <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke="currentColor" strokeOpacity={0.35} />
      <clipPath id="above">
        <rect x={0} y={0} width={width} height={y(0)} />
      </clipPath>
      <clipPath id="below">
        <rect x={0} y={y(0)} width={width} height={height} />
      </clipPath>
      <path d={path} fill="none" className="stroke-up" strokeWidth={2} clipPath="url(#above)" />
      <path d={path} fill="none" className="stroke-down" strokeWidth={2} clipPath="url(#below)" />
      <line x1={x(spot)} x2={x(spot)} y1={pad} y2={height - pad} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="3 3" />
      <text x={x(spot)} y={pad - 8} textAnchor="middle" className="fill-muted text-[10px]">
        now {spot.toFixed(2)}
      </text>
      {breakEvens.map((price) => (
        <g key={price}>
          <circle cx={x(price)} cy={y(0)} r={3} className="fill-text" />
          <text x={x(price)} y={y(0) + 14} textAnchor="middle" className="fill-muted text-[10px]">
            {price.toFixed(2)}
          </text>
        </g>
      ))}
      <text x={pad} y={height - 6} className="fill-muted text-[10px]">
        {low.toFixed(0)}
      </text>
      <text x={width - pad} y={height - 6} textAnchor="end" className="fill-muted text-[10px]">
        {high.toFixed(0)}
      </text>
    </svg>
  );
}

/// PROJECT_BRIEF.md Section 41: build one of seven strategies from the live chain and see net
/// premium, max profit and loss, break-evens, Greeks and the payoff at expiry. The figures come
/// from the pricing service's display quotes; opening a leg still goes through the Options ticket,
/// which asks for a signed quote.
export function StrategyBuilder() {
  const symbol = useTerminal((state) => state.symbol);
  const setSymbol = useTerminal((state) => state.setSymbol);
  const now = useNow();
  const { data: underlyings } = useOptionUnderlyings();
  const symbols = useMemo(() => underlyings?.map((market) => symbolOf(market.marketId)) ?? [], [underlyings]);
  const { data: index } = useIndexPrice(symbol);
  const { data: listed } = useListedExpiries(symbol);

  const [kind, setKind] = useState<StrategyKind>("STRADDLE");
  const [quantityText, setQuantityText] = useState("1");
  const [expiryChoice, setExpiryChoice] = useState<bigint | undefined>();
  const [values, setValues] = useState<number[]>([]);

  useEffect(() => {
    if (!symbol && symbols[0]) setSymbol(symbols[0]);
  }, [symbol, symbols, setSymbol]);

  const expiries = useMemo(
    () => expiryDates(env.options.expiryDays, BigInt(Math.floor(now / 1000)), env.options.expiryHourUtc, listed),
    [now, listed],
  );
  const expiry = expiryChoice ?? expiries[0];
  const ladder = useMemo(() => (index ? strikeLadder(index, env.options.strikeStepBps, env.options.strikeRows) : []), [index]);
  const ladderNumbers = useMemo(() => ladder.map(toNumber), [ladder]);
  const nearest = index ? nearestStrikeIndex(ladder, index) : 0;

  // Start each strategy on sensible strikes; a person's own picks stand until the strategy or the ladder changes.
  const ladderKey = ladderNumbers.join(",");
  useEffect(() => {
    setValues(defaultStrikeValues(kind, ladderNumbers, nearest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, ladderKey]);

  const chain = useOptionChain(symbol, expiry, ladder);
  const quotes = useMemo(() => {
    const map = new Map<string, OptionQuote>();
    for (const row of chain) {
      for (const [type, result] of [["CALL", row.call], ["PUT", row.put]] as const) {
        const data = result.data;
        if (data) {
          map.set(`${type}-${toNumber(row.strike)}`, {
            mark: data.premium,
            bid: data.bid,
            ask: data.ask,
            greeks: { delta: data.delta, gamma: data.gamma, theta: data.theta / 365, vega: data.vega / 100 },
          });
        }
      }
    }
    return map;
  }, [chain]);

  const quantity = Number(quantityText);
  const validQuantity = /^\d+(\.\d+)?$/.test(quantityText) && quantity > 0;
  const spot = index ? toNumber(index) : undefined;

  const analysis = useMemo(() => {
    if (spot === undefined || !validQuantity || values.length !== STRATEGY_FIELDS[kind].length) return { error: undefined as string | undefined, value: undefined };
    try {
      const legs = strategyLegs(kind, strikesFromValues(kind, values), {
        spot,
        quantity,
        quote: (type, strike) => {
          const found = quotes.get(`${type}-${strike}`);
          if (!found) throw new Error("loading");
          return found;
        },
      });
      return { error: undefined, value: analyzeStrategy(legs) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: message === "loading" ? undefined : message.replace(/^strategies: /, ""), value: undefined };
    }
  }, [kind, values, quotes, quantity, validQuantity, spot]);

  const result = analysis.value;
  const range = result && spot !== undefined ? chartRange(result.legs.flatMap((leg) => (leg.strike === undefined ? [] : [leg.strike])), result.breakEvens, spot) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <Panel title="Strategy builder">
        <div className="flex flex-col gap-4 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Underlying
              <select className={selectClass} value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {symbols.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Expiry
              <select className={selectClass} value={String(expiry ?? "")} onChange={(event) => setExpiryChoice(BigInt(event.target.value))}>
                {expiries.map((item) => (
                  <option key={item.toString()} value={item.toString()}>
                    {expiryCode(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Strategy
              <select className={selectClass} value={kind} onChange={(event) => setKind(event.target.value as StrategyKind)}>
                {STRATEGY_KINDS.map((item) => (
                  <option key={item} value={item}>
                    {STRATEGY_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="Units" className="w-28" value={quantityText} onValueChange={setQuantityText} invalid={!validQuantity} placeholder="1" />
            {STRATEGY_FIELDS[kind].map((label, position) => (
              <label key={label} className="flex flex-col gap-1 text-xs text-muted">
                {label}
                <select
                  className={selectClass}
                  value={values[position] ?? ""}
                  onChange={(event) => setValues((current) => current.map((value, i) => (i === position ? Number(event.target.value) : value)))}
                >
                  {ladderNumbers.map((strike) => (
                    <option key={strike} value={strike}>
                      {strike}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="text-sm text-muted">{STRATEGY_SUMMARY[kind]}</p>

          {!env.apiUrl ? (
            <p className="text-down">NEXT_PUBLIC_API_URL is not set, so no option quotes can load.</p>
          ) : analysis.error ? (
            <p className="text-down">{analysis.error}.</p>
          ) : !result || !range || spot === undefined ? (
            <p className="text-muted">Loading quotes…</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Net premium">{fmtNet(result.netPremium)}</Stat>
                <Stat label="Max profit">{fmtLimit(result.maxProfit)}</Stat>
                <Stat label="Max loss">{fmtLimit(result.maxLoss)}</Stat>
                <Stat label="Break-even">{result.breakEvens.length === 0 ? "–" : result.breakEvens.map((price) => price.toFixed(2)).join(" · ")}</Stat>
              </dl>
              <PayoffChart legs={result.legs} low={range[0]} high={range[1]} spot={spot} breakEvens={result.breakEvens} />
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="px-3 py-2 text-left font-normal">Leg</th>
                    <th className="px-3 py-2 text-right font-normal">Strike</th>
                    <th className="px-3 py-2 text-right font-normal">Units</th>
                    <th className="px-3 py-2 text-right font-normal">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {result.legs.map((leg, position) => (
                    <tr key={position} className="border-t border-line">
                      <td className="px-3 py-2">
                        <span className={leg.side === "LONG" ? "text-up" : "text-down"}>{leg.side === "LONG" ? "Long" : "Short"}</span>{" "}
                        {leg.kind === "UNDERLYING" ? "underlying" : leg.kind.toLowerCase()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{leg.strike ?? "–"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{leg.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{`$${leg.price.toFixed(2)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Delta">{result.greeks.delta.toFixed(2)}</Stat>
                <Stat label="Gamma">{result.greeks.gamma.toFixed(4)}</Stat>
                <Stat label="Theta / day">{result.greeks.theta.toFixed(3)}</Stat>
                <Stat label="Vega / pt">{result.greeks.vega.toFixed(3)}</Stat>
              </dl>
              <p className="text-sm text-muted">
                At {spot.toFixed(2)} now:{" "}
                <Num tone={result.payoffAt(spot) < 0 ? "down" : "up"}>{fmtSignedUsd(result.payoffAt(spot))}</Num> if it expired here.{" "}
                {result.executable
                  ? "Every leg can be opened today: open each option from the Options ticket (an underlying leg is a 1x long perp)."
                  : "This strategy has a short option leg. The contracts only let a user buy options, so it cannot be opened yet; the figures show what it would do."}
              </p>
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
