import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "../providers";
import "./globals.css";

const plex = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex", display: "swap" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Orionis Markets",
  description: "Derivatives for tokenized equities.",
  openGraph: {
    title: "Orionis Markets",
    description: "Derivatives for tokenized equities.",
    siteName: "Orionis Markets",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Orionis Markets",
    description: "Derivatives for tokenized equities.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={plex.variable}>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
