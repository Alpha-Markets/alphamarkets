import { chains } from '@alphamarkets/config';
import { env } from '@/lib/env';
import { PAGE_FRAME } from '@/lib/frame';
import { SectionHeader } from './SectionHeader';

/// Every answer traces to PROJECT_BRIEF.md or to something already true elsewhere in the app (the
/// chain name is read live, not hardcoded) — nothing here claims an audit, a fee, or a number that
/// isn't actually backed by the codebase.
const faqs = [
    {
        q: 'What is AlphaMarkets?',
        a: 'An onchain derivatives venue for tokenized equities, built on Robinhood Chain. Options and perpetuals trade from one terminal, against one vault, sharing the same market registry, oracle router and risk engine underneath, not a spot exchange, and not two separate products bolted together.',
    },
    {
        q: 'What can I trade?',
        a: 'Perpetuals for leveraged long or short exposure on tokenized stocks like NVDA, TSLA, AAPL, META and HOOD, and European-style call and put options on the same underlyings for volatility and defined-risk positions. Every option is cash settled, no physical delivery of the underlying token, just a payout in the settlement asset at expiry.',
    },
    {
        q: 'What chain does it run on?',
        a: `AlphaMarkets runs on ${chains[env.chainId].name}, an EVM-compatible chain. Every contract address the terminal talks to is read from configuration rather than hardcoded, so the same frontend can be built for a testnet or a mainnet deployment by changing the build environment.`,
    },
    {
        q: 'How is settlement verified?',
        a: "Every trade settles through the AlphaMarketsVault contract, the one place that holds collateral, tracks locked margin and pays out realized PnL, whether that PnL comes from an option expiring, a perpetual position closing, or a funding payment. Nothing about a settlement lives off-chain waiting to be reconciled; see Smart contracts above for the vault's own address.",
    },
    {
        q: 'How do I verify the contracts myself?',
        a: 'Every contract AlphaMarkets runs on is listed above, in full, not shortened — with a copy button and a link straight to the block explorer for that address. Open any of them and read the deployed bytecode and every transaction it has processed yourself; nothing here asks you to take our word for it.',
    },
];

/// A plain `<details>/<summary>` list — no JS, keyboard-operable for free. The base layer already
/// styles `summary` with a pointer cursor, so this is the pattern the design system expects. The
/// plus/minus turns accent and the row tints on hover, so opening a question reads as the same kind
/// of action as everything else `interactive` marks clickable on this page, rather than a plain
/// text disclosure bolted onto a different visual language. No outer box: the row dividers are the
/// only lines here, and they carry real information (this is a list of separately clickable rows),
/// not a panel drawn around it for its own sake. Full `PAGE_FRAME` width, same as every other
/// section's own content — its left and right edges line up with Products, Markets and Smart
/// contracts above it, not a narrower column of its own.
export function LandingFaq() {
    return (
        <section aria-labelledby="landing-faq" className="py-16 lg:py-24">
            <SectionHeader id="landing-faq" title="FAQ" />
            <div className={PAGE_FRAME}>
                <ul className="divide-y divide-line">
                    {faqs.map((item) => (
                        <li key={item.q}>
                            <details className="group">
                                <summary className="flex list-none items-center justify-between gap-4 py-5 text-lg font-medium transition-colors duration-150 marker:content-none hover:text-accent lg:py-6">
                                    {item.q}
                                    <span
                                        aria-hidden="true"
                                        className="relative size-3 shrink-0 text-muted transition-colors duration-150 group-hover:text-accent group-open:text-accent"
                                    >
                                        <span className="absolute inset-0 my-auto h-px bg-current" />
                                        <span className="absolute inset-0 mx-auto h-full w-px bg-current transition-opacity duration-150 group-open:opacity-0" />
                                    </span>
                                </summary>
                                <p className="-mt-2 max-w-[120ch] pb-5 pl-10 text-lg leading-relaxed text-muted lg:pb-6 lg:pl-12">
                                    {item.a}
                                </p>
                            </details>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
