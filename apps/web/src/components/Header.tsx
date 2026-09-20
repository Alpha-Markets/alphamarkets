"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { PAGE_FRAME } from "@/lib/frame";
import { chip, cn, menuItem, pill } from "@alphamarkets/ui";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";

/// PROJECT_BRIEF.md Section 22, plus the strategy builder from Section 41.
const items = [
  { label: "Markets", href: "/markets" },
  { label: "Options", href: "/options" },
  { label: "Perpetuals", href: "/perpetuals" },
  { label: "Strategies", href: "/strategies" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Activity", href: "/activity" },
];

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // On the landing page the header floats over the full-screen hero with no rule under it; once the
  // page scrolls it takes the page colour so the content beneath does not show through the links.
  const landing = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  // A tap on a link changes the page; the sheet has done its job.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!landing || !main) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(main.scrollTop > 24);
    onScroll();
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [landing]);

  return (
    <header
      ref={ref}
      className={cn(
        "z-40 shrink-0 transition-colors duration-200",
        landing ? cn("absolute inset-x-0 top-0", scrolled ? "bg-ground/90 backdrop-blur" : "bg-transparent") : "relative border-b border-line bg-ground",
      )}
    >
      <div className={cn("flex h-12 items-center justify-between gap-3", landing ? PAGE_FRAME : "px-4")}>
        <div className="flex h-full items-center gap-8">
          <Link href="/" aria-label="AlphaMarkets home" className="pt-1">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden h-full items-center gap-1.5 md:flex">
            {items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn("h-8 self-center px-3 text-sm", pill(current))}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <WalletButton />
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            className={cn(chip, "h-9 px-3 text-sm font-medium md:hidden")}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Primary mobile" className="absolute inset-x-0 top-full border-b border-line bg-ground md:hidden">
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
        </nav>
      ) : null}
    </header>
  );
}
