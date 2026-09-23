import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Tomorrow } from "next/font/google";
import { preconnect } from "react-dom";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { env } from "@/lib/env";
import { THEME_GROUND } from "@/lib/theme-colors";
import { Providers } from "../providers";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
// The landing page's display face: light weights for the headline and statement, italic for the wordmark.
// Imitates orionisderivative.tech's own display choice (see globals.css's --font-serif comment).
const tomorrow = Tomorrow({ subsets: ["latin"], style: ["normal", "italic"], weight: ["300", "400"], variable: "--font-tomorrow", display: "swap" });
// Verifiable data only (contract addresses, chain name, tech-stack tags) — Geist's own mono companion,
// so it pairs with the sans instead of reading as a bolted-on font.
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "AlphaMarkets",
  description: "Derivatives for tokenized equities.",
  openGraph: {
    title: "AlphaMarkets",
    description: "Derivatives for tokenized equities.",
    siteName: "AlphaMarkets",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AlphaMarkets",
    description: "Derivatives for tokenized equities.",
  },
};

export const viewport: Viewport = { themeColor: THEME_GROUND };

/// Open the connections to the chain RPC and the API while the page is still loading, so the first
/// read does not also pay for DNS and TLS (about two seconds cold, against about 0.3 s warm).
const origin = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  for (const target of new Set([origin(env.readRpcUrl), origin(env.apiUrl)])) {
    if (target) preconnect(target, { crossOrigin: "anonymous" });
  }
  return (
    <html lang="en" className={`${geist.variable} ${tomorrow.variable} ${geistMono.variable}`}>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
