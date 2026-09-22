import { chains } from '@alphamarkets/config';
import Link from 'next/link';
import { ArrowIcon } from '@/components/ArrowIcon';
import { Footer } from '@/components/Footer';
import { HeroCardStack } from '@/components/HeroCardStack';
import { HeroMark } from '@/components/HeroMark';
import { LandingContracts } from '@/components/LandingContracts';
import { LandingFaq } from '@/components/LandingFaq';
import { LandingMarkets } from '@/components/LandingMarkets';
import { LandingStats } from '@/components/LandingStats';
import { LandingTicker } from '@/components/LandingTicker';
import { SectionHeader } from '@/components/SectionHeader';
import { SilkBackdrop } from '@/components/SilkBackdrop';
import { StackPyramid } from '@/components/StackPyramid';
import { env } from '@/lib/env';
import { MONO, PAGE_FRAME } from '@/lib/frame';
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
const button =
    'h-11 gap-2 rounded-lg px-4 text-[13px] font-medium uppercase tracking-[0.04em]';

/// PROJECT_BRIEF.md Section 23, kept short. The page opens dark, on the moving backdrop: the logo, the
/// promise and the way in on the left, a live preview of the terminal on the right, both centred in the
/// first screen. The header floats over the hero (see Header), so the hero is the whole first screen.
/// Below it, a light "paper" region carries the rest, in order: what you can trade (Products), the
/// venue's own markets (ticker, totals, the market list), the contracts it runs on and the stack they
/// sit on, then the FAQ, before the footer. The terminal stays the product, and stays dark.
export default function Landing() {
    return (
        <div className="flex min-h-full flex-col">
            <section className="relative min-h-[calc(100dvh-4.375rem)] shrink-0 overflow-hidden">
                <SilkBackdrop />
                <div
                    className={`${PAGE_FRAME} relative grid min-h-[calc(100dvh-4.375rem)] grid-cols-[minmax(0,1fr)] items-center gap-x-16 gap-y-12 pb-12 pt-24 lg:grid-cols-2 lg:pb-16`}
                >
                    <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
                        {/* On a phone the header already carries the mark, so the hero opens on the headline. */}
                        <div className="max-sm:hidden">
                            <HeroMark />
                        </div>
                        <h1 className="max-w-[14ch] sm:mt-8 text-balance font-serif text-[2.5rem] font-light leading-[1.04] tracking-[-0.03em] sm:text-[3.75rem] lg:text-[clamp(3rem,4.5vw,4.5rem)]">
                            Onchain Derivatives for Stock Tokens.
                        </h1>
                        <p className="mt-6 max-w-[45ch] text-lg leading-relaxed text-muted">
                            perpetuals and options on Stock Tokens with
                            real-time market pricing and onchain settlement,
                            built on Robinhood Chain.
                        </p>
                        <div className="mt-10 flex flex-wrap justify-center gap-2 sm:justify-start">
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
                        <p className={cn(MONO, 'mt-6 flex items-center gap-2 text-sm text-muted')}>
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
                            {chains[env.chainId].name}
                        </p>
                    </div>
                    <HeroCardStack />
                </div>
            </section>

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
                                        className={`${PAGE_FRAME} grid items-baseline gap-x-8 gap-y-2 py-[21px] lg:grid-cols-[16rem_minmax(0,1fr)_auto] lg:py-[28px]`}
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
