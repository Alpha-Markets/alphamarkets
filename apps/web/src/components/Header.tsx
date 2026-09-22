"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useDismiss } from "@/hooks/useDismiss";
import { PAGE_FRAME } from "@/lib/frame";
import { X_URL } from "@/lib/social";
import { chip, cn, interactive, menuItem } from "@alphamarkets/ui";
import { Logo } from "./Logo";
import { MenuIcon } from "./MenuIcon";
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

/// Primary nav is plain text on the header's own blur, not another row of boxes: full-brightness
/// text, an accent hairline under the current page, accent text on hover. The hairline is the only
/// thing that moves between states, so nothing shifts size or position when a page changes.
const navLink = (current: boolean) =>
  cn(
    interactive,
    "flex h-full items-center border-b-2 px-1 text-base font-medium",
    current ? "border-accent text-accent" : "border-transparent text-text hover:text-accent",
  );

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Header() {
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  // On the landing page the header floats over the hero, then over the light "paper" section once
  // the page scrolls past it; on every other page it sits in the normal flow above (always dark)
  // content. The nav text itself now carries no fill of its own, so the bar needs one soft, even
  // scrim behind everything (not a box per item) to stay readable against either backdrop.
  const landing = pathname === "/";
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  // A tap on a link changes the page; the sheet has done its job.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      ref={ref}
      className={cn(
        "z-40 shrink-0 bg-ground/70 backdrop-blur-md",
        landing ? "absolute inset-x-0 top-0" : "relative",
      )}
    >
      <div className={cn("flex h-20 items-center justify-between gap-3", landing ? PAGE_FRAME : "px-4")}>
        <div className="flex h-full items-center gap-6">
          <Link href="/" aria-label="AlphaMarkets home" className="flex h-full shrink-0 items-center">
            <Logo />
          </Link>
          <nav aria-label="Primary" className="hidden h-full items-center gap-8 lg:flex">
            {items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined} className={navLink(current)}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <a
            href={X_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="AlphaMarkets on X"
            className={cn(chip, "size-11 shrink-0 justify-center rounded-lg! max-lg:size-10")}
          >
            <XIcon />
          </a>
          {/* On a phone the wallet button lives at the bottom of the menu, which leaves the bar to the logo, X and the menu button. */}
          <div className="max-lg:hidden">
            <WalletButton />
          </div>
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            className={cn(chip, "relative size-10 justify-center rounded-lg! lg:hidden")}
          >
            <MenuIcon open={open} />
            {/* A connected wallet is out of sight in the menu, so the button says so. */}
            {isConnected && !open ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 rounded-full bg-up" /> : null}
          </button>
        </div>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Primary mobile" className="absolute inset-x-0 top-full max-h-[calc(100dvh-4.375rem)] overflow-y-auto bg-ground lg:hidden">
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
          <div className="p-4">
            <WalletButton className="h-12! rounded-lg! text-[13px]! uppercase tracking-[0.04em]" block menuAbove />
          </div>
        </nav>
      ) : null}
    </header>
  );
}
