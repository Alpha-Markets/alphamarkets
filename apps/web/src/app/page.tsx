import { chains } from '@alphamarkets/config';
import Image from 'next/image';
import Link from 'next/link';
import logo from '@/assets/alpha-market-logo.svg';
import { ArrowIcon } from '@/components/ArrowIcon';
import { ContractAddressBadge } from '@/components/ContractAddressBadge';
import { Footer } from '@/components/Footer';
import { HeroAtmosphere } from '@/components/HeroAtmosphere';
import { HeroMarketCarousel } from '@/components/HeroMarketCarousel';
import { HeroSilkBackground } from '@/components/HeroSilkBackground';
import { LandingContracts } from '@/components/LandingContracts';
import { LandingFaq } from '@/components/LandingFaq';
import { LandingMarkets } from '@/components/LandingMarkets';
import { LandingStats } from '@/components/LandingStats';
import { Reveal } from '@/components/Reveal';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { env } from '@/lib/env';
import { CHIP_LABEL, MONO, PAGE_FRAME } from '@/lib/frame';
import { cn, interactive } from '@alphamarkets/ui';

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

export default function Landing() {
    return (
        <div className="flex min-h-full flex-col">
            <HeroAtmosphere />
            <section className="relative min-h-dvh shrink-0 overflow-hidden">
                <HeroSilkBackground />
                <div
                    className={`${PAGE_FRAME} relative flex min-h-dvh flex-col items-center justify-center gap-10 py-24 text-center`}
                >
                    <div className="w-full max-w-4xl">
                        <HeroMarketCarousel />
                    </div>
                    <h1 className="hero-heading max-w-[20ch] text-balance font-bold bg-gradient-to-br from-text via-text to-accent bg-clip-text font-serif text-[2.75rem] font-light leading-[1.04] tracking-[-0.03em] text-transparent sm:text-[4rem] lg:text-[clamp(3.5rem,6vw,6rem)]">
                        Onchain Derivatives for Stock Tokens.
                    </h1>
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
                    <ContractAddressBadge />
                </div>
            </section>

            <Reveal>
                <section aria-label="Introduction">
                    <div
                        className={`${PAGE_FRAME} flex flex-col items-center gap-6 py-20 text-center lg:py-28`}
                    >
                        <Image
                            src={logo}
                            alt="AlphaMarkets"
                            priority
                            className="h-20 w-auto sm:h-24 lg:h-28"
                        />
                        <p className="max-w-[42ch] text-balance font-serif text-[1.75rem] font-light leading-[1.25] tracking-[-0.02em] sm:text-[2.25rem] lg:text-[2.75rem]">
                            AlphaMarkets is perpetuals and options on tokenized
                            stocks, with real-time market pricing and onchain
                            settlement, built on Robinhood Chain.
                        </p>
                        <p
                            className={cn(
                                MONO,
                                'flex items-center gap-2 text-sm text-muted',
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-up"
                            />
                            {chains[env.chainId].name}
                        </p>
                    </div>
                </section>
            </Reveal>

            <div className="relative">
                <Reveal>
                    <section
                        aria-labelledby="landing-products"
                        className="py-16 lg:py-24"
                    >
                        <SectionHeader id="landing-products" title="Products">
                            <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
                                Everything trades from one vault. Collateral,
                                positions and settlement stay onchain the whole
                                way through.
                            </p>
                        </SectionHeader>
                        <div
                            className={`${PAGE_FRAME} mt-6 grid gap-4 sm:grid-cols-3`}
                        >
                            {blocks.map((block) => (
                                <Link
                                    key={block.title}
                                    href={block.href}
                                    className="group flex flex-col gap-4 rounded-panel border border-transparent bg-surface p-6 transition-colors duration-150 hover:border-accent hover:bg-accent-soft/20 lg:p-7"
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="text-[1.5rem] font-light tracking-[-0.02em] transition-colors duration-150 group-hover:text-accent">
                                            {block.title}
                                        </span>
                                        <StatusBadge label="Live" />
                                    </div>
                                    <p className="text-muted">{block.body}</p>
                                    <span className="mt-auto inline-flex items-center gap-2 text-sm text-accent">
                                        {block.cta}
                                        <ArrowIcon className="size-3 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                                    </span>
                                </Link>
                            ))}
                        </div>
                    </section>
                </Reveal>

                <Reveal>
                    <LandingStats />
                </Reveal>
                <Reveal className="pt-16 lg:pt-24">
                    <LandingMarkets />
                </Reveal>

                <Reveal>
                    <LandingContracts />
                </Reveal>

                <Reveal>
                    <LandingFaq />
                </Reveal>
            </div>
            <Footer />
        </div>
    );
}
