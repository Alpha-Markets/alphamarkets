import { chains } from '@alphamarkets/config';
import Image from 'next/image';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import logo from '@/assets/alpha-market-logo.svg';
import { ArrowIcon } from '@/components/ArrowIcon';
import { ContractAddressBadge } from '@/components/ContractAddressBadge';
import { Footer } from '@/components/Footer';
import { HeroSilkBackground } from '@/components/HeroSilkBackgroundLazy';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { env } from '@/lib/env';
import { CHIP_LABEL, MONO, PAGE_FRAME } from '@/lib/frame';
import { cn, interactive } from '@alphamarkets/ui';

// Split into their own chunks so the hero's WebGL/carousel and the below-fold sections
// don't inflate the landing page's initial JS bundle.
const HeroMarketCarousel = dynamic(() =>
    import('@/components/HeroMarketCarousel').then((m) => m.HeroMarketCarousel),
);
const LandingContracts = dynamic(() =>
    import('@/components/LandingContracts').then((m) => m.LandingContracts),
);
const LandingFaq = dynamic(() =>
    import('@/components/LandingFaq').then((m) => m.LandingFaq),
);
const LandingMarkets = dynamic(() =>
    import('@/components/LandingMarkets').then((m) => m.LandingMarkets),
);

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
];

/// Every button on the landing page: a 38px rounded fill with small uppercase type, as on the reference.
const button = `h-11 gap-2 rounded-control px-4 ${CHIP_LABEL}`;

export default function Landing() {
    return (
        <div className="flex min-h-full flex-col">
            <section className="relative min-h-dvh shrink-0 overflow-hidden">
                <HeroSilkBackground />
                <div
                    className={`${PAGE_FRAME} relative flex min-h-dvh flex-col items-center justify-center gap-8 py-24 text-center`}
                >
                    <div className="w-full max-w-4xl">
                        <HeroMarketCarousel />
                    </div>
                    <h1 className="hero-heading max-w-[40ch] text-balance font-bold bg-linear-to-br from-text via-text to-accent bg-clip-text font-serif text-[3.25rem] leading-[1.04] tracking-[-0.03em] text-transparent sm:text-[5.5rem] lg:text-[clamp(3.25rem,6.5vw,5.5rem)]">
                        Alpha Markets
                    </h1>
                    <p className="max-w-[36ch] text-balance text-xl font-medium text-text sm:text-2xl">
                        Onchain Derivatives for Stock Tokens.
                    </p>
                    <p className="max-w-[90ch] text-balance text-base text-muted sm:text-lg">
                        Options and perpetuals on tokenized stocks, with
                        real-time market pricing and onchain settlement, built
                        on Robinhood Chain.
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
                    <ContractAddressBadge />
                </div>
            </section>

            <section aria-label="Introduction">
                <div
                    className={`${PAGE_FRAME} flex flex-col items-center gap-6 py-20 text-center lg:py-28`}
                >
                    <Image
                        src={logo}
                        alt="AlphaMarkets"
                        priority
                        className="h-20 w-auto sm:h-24 lg:h-60"
                    />
                    <p className="max-w-[42ch] text-balance font-serif text-[1.75rem] font-light leading-tight tracking-[-0.02em] sm:text-[2.25rem] lg:text-[2.75rem]">
                        Equities, unchained. Trade stock-tokens as perpetuals
                        and options, fully onchain, no brokers, no gatekeepers,
                        no waiting on market hours. Just code, your wallet, and
                        one shared vault.
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

            <div className="relative">
                <section
                    aria-labelledby="landing-products"
                    className="py-16 lg:py-24"
                >
                    <SectionHeader id="landing-products" title="Products">
                        <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
                            Everything trades from one vault. Collateral,
                            positions and settlement stay onchain the whole way
                            through.
                        </p>
                    </SectionHeader>
                    <div
                        className={`${PAGE_FRAME} mt-6 grid gap-4 sm:grid-cols-2`}
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

                <LandingMarkets />

                <LandingContracts />

                <LandingFaq />
            </div>
            <Footer />
        </div>
    );
}
