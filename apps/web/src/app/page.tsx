import Link from "next/link";
import { Footer } from "@/components/Footer";
import { HeroMark } from "@/components/HeroMark";
import { LandingMarkets } from "@/components/LandingMarkets";
import { SilkBackdrop } from "@/components/SilkBackdrop";
import { PAGE_FRAME } from "@/lib/frame";

const blocks = [
  { title: "Options", body: "Trade volatility and defined-risk exposure.", href: "/options", cta: "Open the option chain" },
  { title: "Perpetuals", body: "Long or short tokenized equities with leverage.", href: "/perpetuals", cta: "Open the terminal" },
  { title: "Onchain", body: "Collateral, positions and settlement remain verifiable.", href: "/activity", cta: "See your transactions" },
];

/// PROJECT_BRIEF.md Section 23, kept short: the promise over a full-screen moving backdrop, then
/// the markets and a line for each product below the fold. The terminal stays the product.
/// The header floats over the hero (see Header), so the hero is the whole viewport.
export default function Landing() {
  return (
    <div className="flex min-h-full flex-col">
      <section className="relative h-dvh min-h-[34rem] shrink-0">
        <SilkBackdrop />
        <HeroMark />
        <div className={`${PAGE_FRAME} relative flex h-full flex-col justify-end pb-24 lg:pb-32`}>
          <h1 className="max-w-5xl text-balance text-[2.75rem] font-light leading-[1.05] tracking-[-0.035em] sm:text-[4rem] lg:text-[5rem] xl:text-[5.75rem]">
            Derivatives for tokenized equities.
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-muted lg:text-lg">Trade options and perpetual derivatives on tokenized markets.</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/perpetuals"
              className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
            >
              Launch terminal
            </Link>
            <Link
              href="/markets"
              className="inline-flex h-11 items-center rounded-lg border border-line px-5 text-sm font-medium hover:border-accent-line hover:bg-raised"
            >
              Explore markets
            </Link>
          </div>
        </div>
        <a href="#markets" aria-label="Scroll to markets" className="absolute inset-x-0 bottom-0 mx-auto flex h-16 w-10 justify-center">
          <span aria-hidden="true" className="silk-cue mt-2 block h-10 w-px bg-muted" />
        </a>
      </section>

      <div className={`${PAGE_FRAME} flex flex-1 flex-col gap-16 py-12 lg:gap-28 lg:py-24`}>
        <div id="markets" className="scroll-mt-24">
          <LandingMarkets />
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          {blocks.map((block) => (
            <div key={block.title} className="rounded-[10px] border border-line/70 bg-surface p-6">
              <dt className="text-title font-light">{block.title}</dt>
              <dd className="mt-2 leading-relaxed text-muted">{block.body}</dd>
              <dd className="mt-4">
                <Link href={block.href} className="text-sm underline underline-offset-2 hover:text-accent">
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
