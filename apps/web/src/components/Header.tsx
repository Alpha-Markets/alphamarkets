"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { PAGE_FRAME } from "@/lib/frame";
import { X_URL } from "@/lib/social";
import { chip, cn, menuItem, pill } from "@alphamarkets/ui";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { XIcon } from "./XIcon";

/// PROJECT_BRIEF.md Section 22, plus the strategy builder from Section 41.
const items = [
  { label: "Markets", href: "/markets" },
  { label: "Options", href: "/options" },
  { label: "Perpetuals", href: "/perpetuals" },
  { label: "Strategies", href: "/strategies" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Activity", href: "/activity" },
];

/// Every header item is its own rounded bubble, as on the reference: small uppercase type in a
/// 38px fill. The bubble supplies size and type; `pill` and `chip` supply the colour states.
const bubble = "inline-flex h-11 items-center rounded-lg! text-[13px] font-medium uppercase tracking-[0.04em]";

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // On the landing page the header floats over the hero, transparent, while the page is at the top. Its
  // bubbles carry their own fills. Once the page scrolls it takes a solid fill: text scrolling up under
  // transparent buttons is unreadable, most of all on a phone where the bar spans the whole width.
  // The header has no border of its own: a border with no colour set is drawn in the text colour, and
  // one added on a page change faded out of off-white for 200 ms.
  const landing = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  // A tap on a link changes the page; the sheet has done its job.
  useEffect(() => setOpen(false), [pathname]);
  // The page scrolls inside `main`, not the window.
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const update = () => setScrolled(main.scrollTop > 8);
    update();
    main.addEventListener("scroll", update, { passive: true });
    return () => main.removeEventListener("scroll", update);
  }, [pathname]);

  return (
    <header
      ref={ref}
      className={cn(
        "z-40 shrink-0 transition-colors duration-200",
        landing
          ? cn("absolute inset-x-0 top-0", scrolled ? "bg-ground" : "bg-transparent")
          : "relative bg-ground",
      )}
    >
      <div className={cn("flex h-16 items-center justify-between gap-3", landing ? PAGE_FRAME : "px-4")}>
        <div className="flex h-full items-center gap-1.5">
          <Link href="/" aria-label="AlphaMarkets home" className={cn(bubble, "mr-1.5 shrink-0 bg-raised px-2.5 hover:bg-accent-soft sm:px-3 active:bg-accent-soft/60")}>
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden h-full items-center gap-1.5 lg:flex">
            {items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(bubble, "self-center px-4", pill(current))}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="AlphaMarkets on X"
            className={cn(chip, "size-11 shrink-0 justify-center rounded-lg! max-lg:size-10 max-[359px]:hidden")}
          >
            <XIcon />
          </a>
          <WalletButton />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            className={cn(chip, "h-10 rounded-lg! px-4 text-[13px] font-medium uppercase tracking-[0.04em] lg:hidden")}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Primary mobile" className="absolute inset-x-0 top-full bg-ground lg:hidden">
          {items.map((item) => {
            const current = isCurrent(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center px-4 text-base font-medium",
                  current ? "bg-accent text-accent-ink" : cn("bg-raised text-muted", menuItem),
                )}
              >
                {item.label}
              </Link>
            );
          })}
          {/* The header button hides on the narrowest phones, where the bar has no room for it. */}
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            className={cn("flex h-12 items-center gap-2 bg-raised px-4 text-base font-medium text-muted min-[360px]:hidden", menuItem)}
          >
            <XIcon />
            AlphaMarkets on X
          </a>
        </nav>
      ) : null}
    </header>
  );
}
