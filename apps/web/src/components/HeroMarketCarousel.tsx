"use client";

import { Num, Skeleton, cn } from "@alphamarkets/ui";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { usePerpMarket, usePerpMarkets } from "@/hooks/queries";
import { fmtPrice } from "@/lib/format";
import { symbolOf } from "@/lib/market";
import { SYMBOL_LOGO } from "./BrandLogos";
import { Change, useStatsFor } from "./Change";

/// The carousel never carries more than this many cards, even when more markets are listed.
const MAX_CARDS = 7;
/// Kept inside the deck's own wrapper box (`max-w-4xl` in page.tsx — offset falloff * gap + half a
/// card must clear the edge, not the page) so neighbour cards clip at the container's own border
/// instead of bleeding across the hero into the headline column.
const CARD_GAP_PX = 170;
const MAX_ROTATION_DEG = 32;
const MAX_DEPTH_PX = 160;
const MIN_SCALE = 0.82;
/// One card's-width of continuous drift per second — the deck never stops between cards, it just
/// keeps gliding and wraps past the last card back to the first.
const AUTOPLAY_SPEED = 1 / 5.5;
/// Drag/wheel distance (px) worth one card of progress, for a continuous scrub feel that matches the
/// autoplay glide instead of snapping in discrete steps.
const DRAG_PX_PER_CARD = 220;
/// How long a manual nudge (drag, arrow key) holds the glide off before it resumes.
const RESUME_DELAY_MS = 1800;

/// A ticker with no known brand mark falls back to this, cycled by index. Stays inside the
/// surface/raised/accent family so it can't be mistaken for the up/down colour Change uses.
const FALLBACK_TONES = ["var(--color-surface)", "var(--color-raised)", "color-mix(in oklab, var(--color-accent-soft) 55%, var(--color-surface))"];

/// The shortest signed distance from `progress` to card `index` around a ring of `count` cards —
/// e.g. with 5 cards, index 0 is +1 away from progress 4, not -4.
function wrappedOffset(index: number, progress: number, count: number): number {
  let raw = (index - progress) % count;
  if (raw > count / 2) raw -= count;
  if (raw < -count / 2) raw += count;
  return raw;
}

/// One card's live price and 24h move.
function Quote({ symbol }: { symbol: string }) {
  const { data } = usePerpMarket(symbol);
  const stats = useStatsFor(symbol);
  return (
    <>
      <Num className="text-lg font-light tracking-[-0.02em]">{data ? fmtPrice(data.markPrice) : <Skeleton className="w-14" />}</Num>
      <p className="mt-1 flex items-center gap-1 text-[11px] opacity-80">
        Live mark · USD
        {stats ? <Change stats={stats} /> : null}
      </p>
    </>
  );
}

/// A 3D carousel of the venue's live markets that glides continuously and loops, rather than
/// stepping card-to-card and holding — drag, scroll or arrow-key nudges it off that glide for a
/// couple of seconds, then it resumes from wherever it was left. Each card takes the company's own
/// brand colour (see BrandLogos.tsx): every card carries its own colour-matched glow, and the deck's
/// shared backdrop glow crossfades to whichever brand colour is active — real per-market colour
/// throughout, not a generated gradient.
export function HeroMarketCarousel() {
  const { data: markets, isPending } = usePerpMarkets();
  const symbols = useMemo(() => (markets ?? []).map((market) => symbolOf(market.marketId)).slice(0, MAX_CARDS), [markets]);
  const count = isPending ? MAX_CARDS : symbols.length;

  // `progress` is the deck's continuous position in card units (2.3 sits 30% of the way from card 2
  // to card 3); it drives every card's transform directly via refs so 60fps motion never round-trips
  // through React state. `active` is only the nearest whole card, kept in state purely for the parts
  // that do need a React re-render — the backdrop glow, the dot pager, link focusability.
  const progressRef = useRef(0);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  const velocityRef = useRef(AUTOPLAY_SPEED);
  const draggingRef = useRef<{ startX: number; startProgress: number } | null>(null);
  const resumeTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (count > 0 && progressRef.current >= count) progressRef.current %= count;
  }, [count]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) velocityRef.current = 0;

    let raf = 0;
    let last = performance.now();
    // Tracks the progress value the DOM was last written for, so a frame where nothing moved
    // (paused glide, not dragging) skips the style writes below instead of re-applying them.
    let lastWrittenProgress = -1;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (count > 0) {
        if (!draggingRef.current) {
          progressRef.current = (progressRef.current + velocityRef.current * dt + count) % count;
        }
        if (progressRef.current !== lastWrittenProgress) {
          lastWrittenProgress = progressRef.current;
          const nearest = Math.round(progressRef.current) % count;
          setActive((current) => (current === nearest ? current : nearest));
          for (let index = 0; index < count; index++) {
            const el = cardRefs.current[index];
            if (!el) continue;
            const offset = wrappedOffset(index, progressRef.current, count);
            const abs = Math.abs(offset);
            const scale = Math.max(MIN_SCALE, 1 - abs * 0.12);
            el.style.transform = `translateX(${offset * CARD_GAP_PX}px) translateZ(${-abs * MAX_DEPTH_PX}px) rotateY(${-offset * MAX_ROTATION_DEG}deg) scale(${scale})`;
            // Continuous falloff to 0, not a cutoff at a fixed offset — a hard `: 0` branch made a card
            // pop out instantly the moment it crossed the threshold, once a frame, every loop: a blink,
            // not a fade.
            el.style.opacity = String(Math.max(0, 1 - abs * 0.34));
            el.style.zIndex = String(100 - Math.round(abs));
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
      }
    };

    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (resumeTimeout.current) clearTimeout(resumeTimeout.current);
    };
    // pauseGlideRef lets the pointer/wheel/keyboard handlers below reach into this same closure
    // without re-running the effect (and restarting the rAF loop) every time `count` is unchanged.
  }, [count]);

  const pauseGlideRef = useRef<() => void>(() => {});
  useEffect(() => {
    pauseGlideRef.current = () => {
      velocityRef.current = 0;
      if (resumeTimeout.current) clearTimeout(resumeTimeout.current);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;
      resumeTimeout.current = setTimeout(() => {
        velocityRef.current = AUTOPLAY_SPEED;
      }, RESUME_DELAY_MS);
    };
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (count === 0) return;
    pauseGlideRef.current();
    draggingRef.current = { startX: event.clientX, startProgress: progressRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = draggingRef.current;
    if (!drag || count === 0) return;
    const dx = event.clientX - drag.startX;
    progressRef.current = (drag.startProgress - dx / DRAG_PX_PER_CARD + count) % count;
  };
  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    pauseGlideRef.current();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      pauseGlideRef.current();
      progressRef.current = (progressRef.current + 1) % count;
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      pauseGlideRef.current();
      progressRef.current = (progressRef.current - 1 + count) % count;
    }
  };

  const activeSymbol = symbols[active];
  const glow = (activeSymbol && SYMBOL_LOGO[activeSymbol]?.background) || "var(--color-accent)";

  return (
    <div className="relative w-full">
      {/* Gradient backdrop "extracted" from the active card's own brand colour — this is the one
          element that changes when the active card does, so the colour crossfades in place instead
          of a new node fading in. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-16 rounded-full opacity-60 blur-3xl transition-[background] duration-500"
        style={{ background: `radial-gradient(closest-side, ${glow}, transparent 70%)` }}
      />
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label="Live markets"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        // Clips neighbour cards to this box — without it, offset cards paint past the deck's own
        // max-w-md and overlap the headline column next to it (a plain CSS transform doesn't widen
        // the layout box, so nothing else here catches that overflow).
        className="relative touch-pan-y overflow-hidden outline-none [perspective:1200px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
        style={{ height: "clamp(260px,34vw,360px)" }}
      >
        {count === 0 ? (
          <div className="flex h-full items-center justify-center rounded-feature border border-line bg-surface">
            <p className="px-6 text-center text-sm text-muted">No perpetual markets are listed yet.</p>
          </div>
        ) : (
          <ul className="absolute inset-0 grid list-none place-items-center [transform-style:preserve-3d]">
            {Array.from({ length: count }, (_, index) => {
              const symbol = symbols[index];
              const offset = wrappedOffset(index, progressRef.current, count);
              const brand = symbol ? SYMBOL_LOGO[symbol] : undefined;
              const background = brand?.background ?? FALLBACK_TONES[index % FALLBACK_TONES.length];
              const ink = brand?.ink ?? "var(--color-accent)";
              const scale = Math.max(MIN_SCALE, 1 - Math.abs(offset) * 0.12);
              return (
                <li
                  key={symbol ?? index}
                  ref={(el) => {
                    cardRefs.current[index] = el;
                  }}
                  aria-hidden={index !== active}
                  className="col-start-1 row-start-1 will-change-transform"
                  style={{
                    // First-paint-only fallback (matches `active`, in sync before the rAF loop below
                    // takes over via the ref and moves `transform`/`opacity` continuously by itself).
                    transform: `translateX(${offset * CARD_GAP_PX}px) translateZ(${-Math.abs(offset) * MAX_DEPTH_PX}px) rotateY(${-offset * MAX_ROTATION_DEG}deg) scale(${scale})`,
                    opacity: Math.max(0, 1 - Math.abs(offset) * 0.34),
                    zIndex: 100 - Math.round(Math.abs(offset)),
                  }}
                >
                  <Link
                    href={symbol ? `/perpetuals?market=${symbol}` : "#"}
                    aria-label={symbol ? `${symbol} perpetual. Open in the terminal.` : "Loading market"}
                    tabIndex={-1}
                    style={{
                      background,
                      color: ink,
                      // Each card glows in its own brand colour, not just the active one — the
                      // elevation shadow stays, a colour-matched halo layers on top of it.
                      boxShadow: `0 20px 45px -20px rgb(0 0 0 / 0.7), 0 0 55px 4px color-mix(in oklab, ${background} 65%, transparent)`,
                    }}
                    className={cn(
                      "flex h-[15.5rem] w-[12.5rem] flex-col justify-between rounded-feature border border-line/70 p-5",
                      index !== active && "pointer-events-none",
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
                      <span aria-hidden="true" className="shrink-0 text-sm opacity-70">
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
