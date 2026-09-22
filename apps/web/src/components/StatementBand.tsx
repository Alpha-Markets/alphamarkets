"use client";

import { useEffect, useRef, useState } from "react";
import { PAGE_FRAME } from "@/lib/frame";

/// PROJECT_BRIEF.md Sections 1, 7 and 47, said as plainly as the brief says them.
const lines = [
  "AlphaMarkets is an onchain derivatives venue for tokenized equities, built for Robinhood Chain.",
  "Options and perpetuals trade from one terminal against one vault. Collateral, positions and settlement remain verifiable onchain.",
  "Trade volatility, direction and leverage, onchain.",
];

/// A band of large serif statements. The one nearest the middle of the screen is at full brightness
/// and the rest recede, so the reader's scroll picks what to read: the only motion here answers an
/// action. Under reduced motion every line stays bright (globals.css).
export function StatementBand() {
  const refs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    // A thin band across the middle of the viewport: whichever line crosses it is the active one.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(refs.current.indexOf(entry.target as HTMLParagraphElement));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const element of refs.current) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label="About AlphaMarkets" className="statement-band text-text">
      <div className={`${PAGE_FRAME} flex flex-col items-center gap-10 py-24 text-center lg:gap-14 lg:py-40`}>
        {lines.map((line, index) => (
          <p
            key={line}
            ref={(element) => {
              refs.current[index] = element;
            }}
            data-active={active === index}
            className="statement-line max-w-[28ch] text-balance font-serif text-[1.75rem] font-light leading-[1.2] tracking-[-0.02em] sm:text-[2.25rem] lg:text-[3.25rem]"
          >
            {line}
          </p>
        ))}
      </div>
    </section>
  );
}
