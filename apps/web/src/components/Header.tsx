"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/hooks/useDismiss";
import { cn } from "@orionis/ui";
import { WalletButton } from "./WalletButton";

/// PROJECT_BRIEF.md Section 22, plus the strategy builder from Section 41.
const items = [
  { label: "Markets", href: "/markets" },
  { label: "Options", href: "/options" },
  { label: "Strategies", href: "/strategies" },
  { label: "Perpetuals", href: "/perpetuals" },
  { label: "Portfolio", href: "/portfolio" },
  { label: "Activity", href: "/activity" },
];

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  // A tap on a link changes the page; the sheet has done its job.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <header ref={ref} className="relative z-40 shrink-0 border-b border-line bg-ground">
      <div className="flex h-12 items-center justify-between gap-3 px-4">
        <div className="flex h-full items-center gap-8">
          <Link href="/" className="text-sm font-medium tracking-[0.32em]">
            ORIONIS
          </Link>
          <nav aria-label="Primary" className="hidden h-full items-stretch gap-6 md:flex">
            {items.map((item) => {
              const current = isCurrent(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex items-center border-b-2 pt-0.5 text-sm",
                    current ? "border-text text-text" : "border-transparent text-muted hover:text-text",
                  )}
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
            className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm font-medium hover:border-faint hover:bg-raised md:hidden"
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
                  "flex h-12 items-center border-l-2 px-4 text-base",
                  current ? "border-text bg-raised text-text" : "border-transparent text-muted",
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
