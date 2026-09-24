"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { Header } from "./Header";
import { LandingTicker } from "./LandingTicker";
import { OptionExpiryAlerts } from "./OptionExpiryAlerts";
import { TriggerAlerts } from "./TriggerAlerts";
import { TxToasts } from "./TxToasts";

/// The frame every page shares: the markets ticker, header, a warning when the RPC is not configured,
/// the scrolling page area and the transaction toasts. Pages render only their own content. The ticker
/// sits above the header on every page, not just the landing page it started on, so the same live
/// strip of prices is always the first thing on screen — one consistent top of page, not a landing-only
/// flourish. It stays in normal flow (never floats), so the header's own float-over-the-hero behaviour
/// on the landing page anchors to the space right below the ticker, not the very top of the viewport.
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink"
      >
        Skip to content
      </a>
      <LandingTicker />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Header />
        {env.rpcConfigured || pathname === "/" ? null : (
          <p role="alert" className="shrink-0 border-b border-line bg-raised px-4 py-2 text-down">
            NEXT_PUBLIC_RPC_URL is not set, so no market data can load. Add it to .env and restart.
          </p>
        )}
        <main id="main" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <TxToasts />
      <TriggerAlerts />
      <OptionExpiryAlerts />
    </div>
  );
}
