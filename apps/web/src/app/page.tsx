import Link from "next/link";
import { Footer } from "@/components/Footer";
import { LandingHero } from "@/components/LandingHero";
import { LandingMarkets } from "@/components/LandingMarkets";
import { SilkBanner } from "@/components/SilkBanner";

const blocks = [
  { title: "Options", body: "Trade volatility and defined-risk exposure.", href: "/options", cta: "Open the option chain" },
  { title: "Perpetuals", body: "Long or short tokenized equities with leverage.", href: "/perpetuals", cta: "Open the terminal" },
  { title: "Onchain", body: "Collateral, positions and settlement remain verifiable.", href: "/activity", cta: "See your transactions" },
];

/// PROJECT_BRIEF.md Section 23, kept short: the promise, a live market, the markets, and a
/// line for each product. The terminal stays the product.
export default function Landing() {
  return (
    <div className="flex min-h-full flex-col">
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-16 px-4 py-12 sm:px-6 lg:gap-28 lg:py-24">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-14">
          <div className="lg:pt-6">
            <h1 className="max-w-2xl text-[2.5rem] font-light leading-[1.05] tracking-[-0.035em] sm:text-display lg:text-[4.25rem]">
              Derivatives for tokenized equities.
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-muted">Trade options and perpetual derivatives on tokenized markets.</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                href="/perpetuals"
                className="inline-flex h-11 items-center rounded-lg bg-text px-5 text-sm font-medium text-ground hover:bg-text/85"
              >
                Launch terminal
              </Link>
              <Link
                href="/markets"
                className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-sm font-medium hover:border-faint hover:bg-raised"
              >
                Explore markets
              </Link>
            </div>
          </div>
          <LandingHero />
        </div>

        <SilkBanner className="h-40 sm:h-56" />

        <LandingMarkets />

        <dl className="grid gap-3 sm:grid-cols-3">
          {blocks.map((block) => (
            <div key={block.title} className="rounded-[10px] border border-line/70 bg-surface p-6">
              <dt className="text-title font-light">{block.title}</dt>
              <dd className="mt-2 leading-relaxed text-muted">{block.body}</dd>
              <dd className="mt-4">
                <Link href={block.href} className="text-sm underline underline-offset-2 hover:text-muted">
                  {block.cta}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <Footer />
    </div>
  );
}
