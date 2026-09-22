"use client";

import { Num, Skeleton, cn } from "@alphamarkets/ui";
import Link from "next/link";
import type { CSSProperties } from "react";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { SYMBOL_LOGO } from "./BrandLogos";
import { Change, useStatsFor } from "./Change";

/// The ring never carries more than this many cards, even when more markets are listed.
const MAX_CARDS = 5;

/// A ticker with no known brand mark falls back to this, cycled by index. Stays inside the
/// surface/raised/accent family so it can't be mistaken for the up/down colour Change uses.
const FALLBACK_TONES = ["var(--color-surface)", "var(--color-raised)", "color-mix(in oklab, var(--color-accent-soft) 55%, var(--color-surface))"];

/// A card's fixed position on the ring: evenly spaced by angle, each pushed outward by the same
/// radius. Nothing here changes over time — only .stock-stage's own rotateY animates (see
/// globals.css), so every card rides along for free as part of one rotated 3D group. That is what
/// makes the motion smooth: the browser animates a single transform on a single element every
/// frame, not five elements' transform/filter/z-index from JS.
function slotStyle(index: number, count: number): CSSProperties {
  return { "--i": index, "--n": count } as CSSProperties;
}

/// One card's live price and 24h move, read the same way HeroTerminal used to.
function Quote({ symbol }: { symbol: string }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  return (
    <>
      <Num className="text-lg font-light tracking-[-0.02em]">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-14" />}</Num>
      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted">
        Live mark · USD
        {stats ? <Change stats={stats} /> : null}
      </p>
    </>
  );
}

/// A ring of the venue's live markets, turning continuously in real 3D (see .stock-scene/.stock-stage
/// in globals.css: perspective on the scene, transform-style: preserve-3d on the stage, one CSS
/// animation spinning the whole stage). Perspective foreshortening does the size/depth work that a
/// hand-rolled per-frame scale/brightness loop used to — the browser's compositor handles it, so
/// there is nothing left to run on the main thread once the cards are placed. Each card opens that
/// market's terminal on click; the site's global prefers-reduced-motion rule already freezes any
/// CSS animation to a single frame, so the ring stops there with no extra code.
export function HeroCardStack() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = (markets ?? []).map((market) => symbolOf(market.marketId)).slice(0, MAX_CARDS);
  const count = isPending ? MAX_CARDS : symbols.length;

  return (
    <div className="relative w-full max-w-[26rem] justify-self-end">
      <span aria-hidden="true" className="pointer-events-none absolute -inset-12 bg-[radial-gradient(closest-side,rgb(58_219_208/0.14),transparent)]" />
      <div className="stock-scene relative" style={{ height: "clamp(200px,26vw,252px)" }}>
        {symbols.length === 0 && !isPending ? (
          <div className="flex h-full items-center justify-center rounded-[14px] border border-line bg-surface">
            <p className="px-6 text-center text-sm text-muted">No perpetual markets are listed yet.</p>
          </div>
        ) : (
          <ul role="list" aria-label="Live markets" className="stock-stage absolute inset-0 list-none">
            {Array.from({ length: count }, (_, index) => {
              const symbol = symbols[index];
              const brand = symbol ? SYMBOL_LOGO[symbol] : undefined;
              const background = brand?.background ?? FALLBACK_TONES[index % FALLBACK_TONES.length];
              const ink = brand?.ink ?? "var(--color-accent)";
              return (
                <li key={symbol ?? index} className="stock-slot absolute inset-0 m-auto" style={slotStyle(index, count)}>
                  <Link
                    href={symbol ? `/perpetuals?market=${symbol}` : "#"}
                    aria-label={symbol ? `${symbol} perpetual. Open in the terminal.` : "Loading market"}
                    tabIndex={symbol ? 0 : -1}
                    style={{ background, color: ink }}
                    className={cn(
                      "stock-card flex h-full w-full flex-col justify-between rounded-[10px] border border-line/70 p-4 shadow-[0_20px_45px_-20px_rgb(0_0_0/0.7)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      !symbol && "pointer-events-none",
                    )}
                  >
                    <div className="flex items-start justify-between text-[11px] font-semibold uppercase tracking-[0.04em]">
                      <span>{symbol ?? <Skeleton className="w-10" />}</span>
                      <span className="opacity-60">
                        {String(index + 1).padStart(2, "0")}/{String(count).padStart(2, "0")}
                      </span>
                    </div>
                    {brand ? (
                      <brand.Logo className="mx-auto h-[38%] w-auto self-center opacity-95" />
                    ) : (
                      <span aria-hidden="true" className="mx-auto grid size-12 place-items-center self-center rounded-full border border-current text-lg font-medium">
                        {symbol?.charAt(0) ?? ""}
                      </span>
                    )}
                    <div className="flex items-end justify-between gap-2">
                      <div className="min-w-0">{symbol ? <Quote symbol={symbol} /> : <Skeleton className="h-5 w-16" />}</div>
                      <span aria-hidden="true" className="shrink-0 text-sm opacity-70 transition-opacity group-hover:opacity-100">
                        ↗
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
