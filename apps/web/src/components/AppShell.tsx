"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { Header } from "./Header";
import { TxToasts } from "./TxToasts";

/// The frame every page shares: header, a warning when the RPC is not configured, the scrolling
/// page area and the transaction toasts. Pages render only their own content.
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
      <Header />
      {env.rpcConfigured || pathname === "/" ? null : (
        <p role="alert" className="shrink-0 border-b border-line bg-raised px-4 py-2 text-down">
          NEXT_PUBLIC_RPC_URL is not set, so no market data can load. Add it to .env and restart.
        </p>
      )}
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </main>
      <TxToasts />
    </div>
  );
}
