"use client";

import { cn } from "@alphamarkets/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PAGE_FRAME, SECTION_TITLE } from "@/lib/frame";

/// The start of a landing page section: a short accent segment — the same corner-bracket language the
/// hero's canvas draws, carried down as a mark rather than reused wholesale — then the title on the
/// page gutters with an optional action on the right and an optional line under it. No full-width rule
/// across the page: the segment alone, plus the section's own vertical spacing, is enough to mark
/// where it begins without stacking a hairline on top of every section on a page that already has
/// plenty of them (row dividers, card edges). The accent segment charges in left-to-right and glows
/// once, the first time the section is reached (skipped under reduced motion) — a small, consistent
/// beat at the top of every section, the same one every time, so scrolling to the next section always
/// answers with something.
export function SectionHeader({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [charged, setCharged] = useState(false);
  // Glows only for the charge-in itself, then settles — the tick stays lit at full length, but the
  // glow around it is the one-off spark, not a permanent halo every revealed section would carry.
  const [glowing, setGlowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let glowTimeout: ReturnType<typeof setTimeout> | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const charge = () => {
      setCharged(true);
      if (reduced) return;
      setGlowing(true);
      glowTimeout = setTimeout(() => setGlowing(false), 650);
    };
    if (reduced) {
      charge();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          charge();
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (glowTimeout) clearTimeout(glowTimeout);
    };
  }, []);

  return (
    <div ref={ref} className={`${PAGE_FRAME} pb-6 pt-6 lg:pb-8 lg:pt-8`}>
      <span
        aria-hidden="true"
        className={cn(
          "mb-4 block h-px w-10 origin-left bg-accent transition-[transform,box-shadow] duration-500 ease-out sm:w-16",
          charged ? "scale-x-100" : "scale-x-0",
          glowing ? "shadow-[0_0_12px_var(--color-accent)]" : "shadow-none",
        )}
      />
      <div className="flex items-end justify-between gap-3">
        <h2 id={id} className={SECTION_TITLE}>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}
