import Link from "next/link";
import { ArrowIcon } from "@/components/ArrowIcon";
import { Footer } from "@/components/Footer";
import { HeroMark } from "@/components/HeroMark";
import { HeroTerminal } from "@/components/HeroTerminal";
import { LandingMarkets } from "@/components/LandingMarkets";
import { LandingStats } from "@/components/LandingStats";
import { LandingTicker } from "@/components/LandingTicker";
import { SilkBackdrop } from "@/components/SilkBackdrop";
import { StatementBand } from "@/components/StatementBand";
import { PAGE_FRAME } from "@/lib/frame";
import { cn, interactive, rowLink } from "@alphamarkets/ui";

const blocks = [
  { title: "Options", body: "Trade volatility and defined-risk exposure.", href: "/options", cta: "Open the option chain" },
  { title: "Perpetuals", body: "Long or short tokenized equities with leverage.", href: "/perpetuals", cta: "Open the terminal" },
  { title: "Onchain", body: "Collateral, positions and settlement remain verifiable.", href: "/activity", cta: "See your transactions" },
];

/// Every button on the landing page: a 38px rounded fill with small uppercase type, as on the reference.
const button = "h-11 gap-2 rounded-lg px-4 text-[13px] font-medium uppercase tracking-[0.04em]";

/// PROJECT_BRIEF.md Section 23, kept short. The page opens dark, on the moving backdrop: the logo, the
/// promise and the way in on the left, a live preview of the terminal on the right, both centred in the
/// first screen. The ticker then hands over to a light
/// "paper" region: the venue's totals, the markets and a line for each product, a statement band
/// and the footer. The terminal stays the product, and stays dark. The header floats over the hero
/// (see Header), so the hero and the ticker together are the whole first screen.
export default function Landing() {
  return (
    <div className="flex min-h-full flex-col">
      <section className="relative min-h-[calc(100dvh-4.5rem)] shrink-0 overflow-hidden">
        <SilkBackdrop />
        <div className={`${PAGE_FRAME} relative grid min-h-[calc(100dvh-4.5rem)] grid-cols-[minmax(0,1fr)] items-center gap-x-16 gap-y-12 pb-12 pt-24 lg:grid-cols-2 lg:pb-16`}>
          <div className="flex flex-col items-start">
            <HeroMark />
            <h1 className="mt-8 max-w-[14ch] text-balance font-serif text-[2.5rem] font-light leading-[1.04] tracking-[-0.03em] sm:text-[3.75rem] lg:text-[clamp(3rem,4.5vw,4.5rem)]">
              Derivatives for Tokenized Equities.
            </h1>
            <p className="mt-6 max-w-[40ch] text-lg leading-relaxed text-muted">Trade options and perpetual derivatives on tokenized markets.</p>
            <div className="mt-10 flex flex-wrap gap-2">
              <Link
                href="/perpetuals"
                className={cn(
                  button,
                  "inline-flex items-center bg-accent text-accent-ink transition-[background-color,box-shadow] duration-150 hover:bg-accent-hover hover:shadow-[0_0_0_3px_var(--color-accent-line)] active:bg-accent-press active:shadow-none",
                )}
              >
                Trade
                <ArrowIcon />
              </Link>
              <Link
                href="/markets"
                className={cn(
                  button,
                  interactive,
                  "inline-flex items-center border border-text/30 text-text hover:border-accent hover:bg-accent-soft hover:text-accent active:border-accent active:bg-accent active:text-accent-ink",
                )}
              >
                Explore markets
              </Link>
            </div>
          </div>
          <HeroTerminal />
        </div>
      </section>

      <div className="paper">
        <LandingTicker />
        <div className="mx-auto max-w-[1280px] sm:border-x sm:border-line">
          <div className="mx-auto max-w-[820px] sm:border-x sm:border-line">
            <LandingStats />
            <div className="pt-16 lg:pt-24">
              <LandingMarkets />
            </div>
            <section aria-labelledby="landing-products" className="py-16 lg:py-24">
              <h2 id="landing-products" className="px-6 pb-4 text-sm text-muted sm:px-[68px]">
                Products
              </h2>
              <ul className="divide-y divide-line border-y border-line">
                {blocks.map((block) => (
                  <li key={block.title}>
                    <Link
                      href={block.href}
                      className={cn(
                        rowLink,
                        "grid items-baseline gap-x-6 gap-y-1 px-6 py-5 sm:grid-cols-[8rem_1fr_auto] sm:px-[68px]",
                      )}
                    >
                      <span className="text-title font-light">{block.title}</span>
                      <span className="leading-relaxed text-muted">{block.body}</span>
                      <span className="mt-2 inline-flex items-center gap-2 text-sm sm:mt-0">
                        {block.cta}
                        <ArrowIcon />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
        <StatementBand />
      </div>
      <Footer />
    </div>
  );
}
