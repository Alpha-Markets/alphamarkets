"use client";

import { Button, cn, textLink } from "@alphamarkets/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSettlementDecimals } from "@/hooks/queries";
import { useTriggerFills } from "@/hooks/useTriggerFills";
import { fillTitle, summarize, type Fill, type FillKind } from "@/lib/fills";
import { fmtPrice } from "@/lib/format";
import { isMuted, playFillSound, setMuted } from "@/lib/sound";
import { useFillStore, type FillAlert } from "@/stores/fills";

const SHOW_MS = 10_000;

/// Signed dollar figure from a settlement-token amount, as a plain number so `CountUp`-style animation works.
function money(amount: number): string {
  const text = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 ? "−" : amount > 0 ? "+" : ""}$${text}`;
}

function toNumber(pnl: bigint | undefined, decimals: number): number | undefined {
  return pnl === undefined ? undefined : Number(pnl) / 10 ** decimals;
}

/// Counts a figure up from 0 once, on mount. Shows the final value at once under `prefers-reduced-motion`.
function Tally({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{money(shown)}</>;
}

const PIECES = 16;

/// A short burst of coloured specks from the top of the card. Decoration only, and left out entirely
/// under `prefers-reduced-motion`.
function Burst() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  if (reduced) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0">
      {Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * Math.PI - Math.PI; // upward half-circle
        const reach = 70 + (i % 4) * 22;
        return (
          <span
            key={i}
            className="fill-speck absolute left-1/2 top-2 h-1.5 w-1.5 rounded-[1px]"
            style={
              {
                "--dx": `${Math.cos(angle) * reach * 1.6}px`,
                "--dy": `${Math.sin(angle) * reach}px`,
                "--rot": `${(i * 47) % 360}deg`,
                background: i % 3 === 0 ? "var(--color-accent)" : "var(--color-up)",
                animationDelay: `${(i % 5) * 30}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

const cardTone: Record<FillKind | "summary", string> = {
  TAKE_PROFIT: "border-up/60 shadow-up-glow fill-pop",
  STOP_LOSS: "border-line fill-pop",
  LIQUIDATION: "border-down/60 fill-pop",
  TRIGGER: "border-line fill-pop",
  summary: "border-line fill-pop",
};

const subline: Record<FillKind, string> = {
  TAKE_PROFIT: "Your target was reached and the profit is banked.",
  STOP_LOSS: "The position closed at your stop, which protected the rest of your capital.",
  LIQUIDATION: "The position lost more than its margin could hold and was closed.",
  TRIGGER: "Your trigger order fired and the position is closed.",
};

function FillBody({ fill, decimals }: { fill: Fill; decimals: number }) {
  const pnl = toNumber(fill.pnl, decimals);
  const side = fill.isLong === undefined ? "" : fill.isLong ? "Long · " : "Short · ";
  return (
    <>
      <p className="text-base font-semibold">{fillTitle[fill.kind]}</p>
      <p className="mt-0.5 text-xs text-muted">
        {side}Position #{fill.positionId}
        {fill.price !== undefined ? ` · closed at $${fmtPrice(fill.price)}` : ""}
      </p>
      {pnl !== undefined ? (
        <p
          className={cn(
            "mt-3 text-3xl font-semibold tabular-nums",
            pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-muted",
          )}
        >
          <Tally value={pnl} />
        </p>
      ) : null}
      <p className="mt-2 text-sm leading-snug text-muted">{subline[fill.kind]}</p>
    </>
  );
}

function SummaryBody({ fills, decimals }: { fills: Fill[]; decimals: number }) {
  const { count, pnl } = summarize(fills);
  const net = toNumber(pnl, decimals);
  return (
    <>
      <p className="text-base font-semibold">While you were away</p>
      <p className="mt-0.5 text-xs text-muted">
        {count} position{count === 1 ? "" : "s"} closed by triggers or liquidation
      </p>
      {net !== undefined ? (
        <p className={cn("mt-3 text-3xl font-semibold tabular-nums", net > 0 ? "text-up" : net < 0 ? "text-down" : "text-muted")}>
          <Tally value={net} />
        </p>
      ) : null}
    </>
  );
}

function AlertCard({ alert }: { alert: FillAlert }) {
  const dismiss = useFillStore((state) => state.dismiss);
  const { data: decimals = 6 } = useSettlementDecimals();
  const [muted, setMutedState] = useState(false);
  useEffect(() => setMutedState(isMuted()), []);

  const kind: FillKind | "summary" = alert.type === "summary" ? "summary" : alert.fill.kind;
  const sound: FillKind =
    alert.type === "fill" ? alert.fill.kind : (summarize(alert.fills).pnl ?? 0n) > 0n ? "TAKE_PROFIT" : "STOP_LOSS";

  // Sound plays once as the card appears, then it leaves by itself after a while.
  useEffect(() => {
    playFillSound(sound);
    const timer = setTimeout(() => dismiss(alert.id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [alert.id, dismiss, sound]);

  // A hidden tab shows the result in its title, so the user sees it in the tab bar too.
  useEffect(() => {
    if (!document.hidden) return;
    const original = document.title;
    const title = alert.type === "fill" ? fillTitle[alert.fill.kind] : "While you were away";
    document.title = `● ${title}`;
    const restore = () => {
      if (!document.hidden) document.title = original;
    };
    document.addEventListener("visibilitychange", restore);
    return () => {
      document.removeEventListener("visibilitychange", restore);
      document.title = original;
    };
  }, [alert]);

  return (
    <div className={cn("pointer-events-auto relative rounded-lg border bg-raised p-4", cardTone[kind])}>
      {kind === "TAKE_PROFIT" ? <Burst /> : null}
      {alert.type === "fill" ? <FillBody fill={alert.fill} decimals={decimals} /> : <SummaryBody fills={alert.fills} decimals={decimals} />}
      <div className="mt-3 flex items-center justify-between gap-3">
        <Link href="/activity" className={cn("text-xs", textLink)} onClick={() => dismiss(alert.id)}>
          View in history
        </Link>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={muted}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
          >
            {muted ? "Sound off" : "Sound on"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => dismiss(alert.id)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/// Tells the user when the protocol closed a position for them: a take-profit or stop-loss firing, or a
/// liquidation. Shows one alert at a time. On a phone it sits at the bottom, clear of the transaction
/// toasts at the top; on a wide screen it sits top right, clear of the ones at the bottom right.
export function TriggerAlerts() {
  useTriggerFills();
  const alert = useFillStore((state) => state.alerts[0]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-24 sm:w-96"
    >
      {alert ? <AlertCard key={alert.id} alert={alert} /> : null}
    </div>
  );
}
