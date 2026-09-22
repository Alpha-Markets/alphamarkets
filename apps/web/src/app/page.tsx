import { chains } from '@alphamarkets/config';
import Link from 'next/link';
import { ArrowIcon } from '@/components/ArrowIcon';
import { Footer } from '@/components/Footer';
import { HeroAtmosphere } from '@/components/HeroAtmosphere';
import { HeroMarketCarousel } from '@/components/HeroMarketCarousel';
import { LandingContracts } from '@/components/LandingContracts';
import { LandingFaq } from '@/components/LandingFaq';
import { LandingMarkets } from '@/components/LandingMarkets';
import { LandingStats } from '@/components/LandingStats';
import { LandingTicker } from '@/components/LandingTicker';
import { SectionHeader } from '@/components/SectionHeader';
import { StackPyramid } from '@/components/StackPyramid';
import { StatementBand } from '@/components/StatementBand';
import { env } from '@/lib/env';
import { CHIP_LABEL, MONO, PAGE_FRAME } from '@/lib/frame';
import { cn, interactive, rowLink } from '@alphamarkets/ui';

const blocks = [
    {
        title: 'Options',
        body: 'Trade volatility and defined-risk exposure.',
        href: '/options',
        cta: 'Open the option chain',
    },
    {
        title: 'Perpetuals',
        body: 'Long or short tokenized equities with leverage.',
        href: '/perpetuals',
        cta: 'Open the terminal',
    },
    {
        title: 'Onchain',
        body: 'Collateral, positions and settlement remain verifiable.',
        href: '/activity',
        cta: 'See your transactions',
    },
];

/// Every button on the landing page: a 38px rounded fill with small uppercase type, as on the reference.
const button = `h-11 gap-2 rounded-control px-4 ${CHIP_LABEL}`;

/// PROJECT_BRIEF.md Section 23, kept short. The page opens dark, on the animated backdrop (imitating
/// openjev.sh's hero, in the mark's own teal): the live market carousel first — the most alive thing
/// on the page, in real per-company colour, real prices — then the promise and the way in, all one
/// centred column, top to bottom at every width (no breakpoint-dependent recomposition). The header
/// floats over the hero (see Header), so the hero is the whole first screen. Still dark, the statement
/// band says what AlphaMarkets is (PROJECT_BRIEF.md Sections 1, 7, 47) before the page turns to what
/// it does. Below that, a light "paper" region carries the rest, in order: what you can trade
/// (Products), the venue's own markets (ticker, totals, the market list), the contracts it runs on and
/// the stack they sit on, then the FAQ, before the footer. The terminal stays the product, and stays dark.
export default function Landing() {
    return (
        <div className="flex min-h-full flex-col">
            <section className="relative min-h-dvh shrink-0 overflow-hidden">
                <HeroAtmosphere />
                <div
                    className={`${PAGE_FRAME} relative flex min-h-dvh flex-col items-center justify-center gap-10 py-24 text-center`}
                >
                    <div className="w-full max-w-xl">
                        <HeroMarketCarousel />
                    </div>
                    <h1 className="max-w-[20ch] text-balance font-serif text-[2.75rem] font-light leading-[1.04] tracking-[-0.03em] sm:text-[4rem] lg:text-[clamp(3.5rem,6vw,6rem)]">
                        Onchain Derivatives for Stock Tokens.
                    </h1>
                    <p className="max-w-[45ch] text-lg leading-relaxed text-muted">
                        perpetuals and options on Stock Tokens with
                        real-time market pricing and onchain settlement,
                        built on Robinhood Chain.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                        <Link
                            href="/perpetuals"
                            className={cn(
                                button,
                                'inline-flex items-center bg-accent text-accent-ink transition-[background-color,box-shadow] duration-150 hover:bg-accent-hover hover:shadow-[0_0_0_3px_var(--color-accent-line)] active:bg-accent-press active:shadow-none',
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
                                'inline-flex items-center border border-text/30 text-text hover:border-accent hover:bg-accent-soft hover:text-accent active:border-accent active:bg-accent active:text-accent-ink',
                            )}
                        >
                            Explore markets
                        </Link>
                    </div>
                    {/* A quiet "we're live" signal, not a competing headline — addresses live in the
                        Smart Contracts section further down, so this doesn't duplicate them. */}
                    <p className={cn(MONO, 'flex items-center gap-2 text-sm text-muted')}>
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
                        {chains[env.chainId].name}
                    </p>
                </div>
            </section>

            <StatementBand />

            <div className="paper">
                <section
                    aria-labelledby="landing-products"
                    className="py-16 lg:py-24"
                >
                    <SectionHeader id="landing-products" title="Products" />
                    <ul className="divide-y divide-line border-y border-line">
                        {blocks.map((block) => (
                            <li key={block.title}>
                                <Link
                                    href={block.href}
                                    className={cn(rowLink, 'block')}
                                >
                                    <div
                                        className={`${PAGE_FRAME} grid items-baseline gap-x-8 gap-y-2 py-6 lg:grid-cols-[16rem_minmax(0,1fr)_auto] lg:py-8`}
                                    >
                                        <span className="text-[1.5rem] font-light tracking-[-0.02em] sm:text-[1.75rem]">
                                            {block.title}
                                        </span>
                                        <span className="text-lg leading-relaxed text-muted">
                                            {block.body}
                                        </span>
                                        <span className="mt-2 inline-flex items-center gap-2 text-sm lg:mt-0">
                                            {block.cta}
                                            <ArrowIcon />
                                        </span>
                                    </div>
                                </Link>
                            </li>
                        ))}
                    </ul>
                </section>

                <LandingTicker />
                <LandingStats />
                <div className="pt-16 lg:pt-24">
                    <LandingMarkets />
                </div>

                <LandingContracts />

                <section
                    aria-labelledby="landing-stack"
                    className="pb-16 lg:pb-24"
                >
                    <SectionHeader id="landing-stack" title="Tech stack">
                        <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
                            Each layer stands on the one below it. Pick one to
                            see what it is made of.
                        </p>
                    </SectionHeader>
                    <div className={`${PAGE_FRAME} mt-4 lg:mt-6`}>
                        <StackPyramid />
                    </div>
                </section>

                <LandingFaq />
            </div>
            <Footer />
        </div>
    );
}
