import { chains } from "@alphamarkets/config";
import { env } from "@/lib/env";
import { PAGE_FRAME } from "@/lib/frame";
import { SectionHeader } from "./SectionHeader";

/// Every answer traces to PROJECT_BRIEF.md or to something already true elsewhere in the app (the
/// chain name is read live, not hardcoded) — nothing here claims an audit, a fee, or a number that
/// isn't actually backed by the codebase.
const faqs = [
  {
    q: "What is AlphaMarkets?",
    a: "An onchain derivatives venue for tokenized equities, built on Robinhood Chain — options and perpetuals, not a spot exchange.",
  },
  {
    q: "What can I trade?",
    a: "Perpetuals for leveraged long or short exposure, and options for volatility and defined-risk positions, on tokenized stocks.",
  },
  {
    q: "What chain does it run on?",
    a: `AlphaMarkets runs on ${chains[env.chainId].name}. Collateral, positions and settlement all happen onchain.`,
  },
  {
    q: "How is settlement verified?",
    a: "Every trade settles through the vault contract. Collateral and positions are checkable onchain at any time — see Smart contracts above.",
  },
  {
    q: "How do I verify the contracts myself?",
    a: "Every contract AlphaMarkets runs on is listed above with a link to the block explorer. Nothing is taken on trust.",
  },
];

/// A plain `<details>/<summary>` list — no JS, keyboard-operable for free. The base layer already
/// styles `summary` with a pointer cursor, so this is the pattern the design system expects.
export function LandingFaq() {
  return (
    <section aria-labelledby="landing-faq" className="py-16 lg:py-24">
      <SectionHeader id="landing-faq" title="FAQ" />
      <ul className="divide-y divide-line border-y border-line">
        {faqs.map((item) => (
          <li key={item.q}>
            <details className="group">
              <summary className={`${PAGE_FRAME} flex list-none items-center justify-between gap-4 py-[21px] text-lg font-medium marker:content-none lg:py-[28px]`}>
                {item.q}
                <span aria-hidden="true" className="relative size-3 shrink-0">
                  <span className="absolute inset-0 my-auto h-px bg-current" />
                  <span className="absolute inset-0 mx-auto h-full w-px bg-current transition-opacity duration-150 group-open:opacity-0" />
                </span>
              </summary>
              <p className={`${PAGE_FRAME} -mt-2 max-w-[65ch] pb-[21px] text-lg leading-relaxed text-muted lg:pb-[28px]`}>{item.a}</p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
