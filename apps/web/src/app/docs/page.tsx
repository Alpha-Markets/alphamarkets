import { chains } from '@alphamarkets/config';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ContractAddressBadge } from '@/components/ContractAddressBadge';
import { DocsLiveParameters } from '@/components/DocsLiveParameters';
import { Footer } from '@/components/Footer';
import { env } from '@/lib/env';
import { explorerAddressUrl } from '@/lib/explorer';
import { MONO, PAGE_FRAME } from '@/lib/frame';
import { cn, listLink } from '@alphamarkets/ui';

export const metadata: Metadata = {
    title: 'Docs · AlphaMarkets',
    description:
        'How AlphaMarkets perpetuals, options, margin, liquidation and settlement work on Robinhood Chain mainnet, checked against the deployed contracts.',
};

/// Every claim on this page comes from the Solidity source in `packages/contracts/src`, and the file
/// that backs it is named under the section. A number that an admin can change (fees, leverage tiers,
/// caps) is not written here at all: `DocsLiveParameters` reads it from the chain. A limit that the
/// code has today is stated as a limit, not left out.
const SECTIONS = [
    { id: 'overview', title: 'Overview' },
    { id: 'network', title: 'Network and token' },
    { id: 'start', title: 'Deposit, trade, withdraw' },
    { id: 'perps', title: 'Perpetuals' },
    { id: 'orders', title: 'Limit, stop-loss and take-profit orders' },
    { id: 'liquidation', title: 'Liquidation' },
    { id: 'funding', title: 'Funding' },
    { id: 'options', title: 'Options' },
    { id: 'oracle', title: 'Price feeds' },
    { id: 'parameters', title: 'Live parameters' },
    { id: 'limits', title: 'Known limits' },
    { id: 'verify', title: 'Verify it yourself' },
] as const;

const bodyText = 'text-lg leading-[1.7] text-muted';

function Section({
    id,
    title,
    sources,
    children,
}: {
    id: string;
    title: string;
    sources?: string[];
    children: ReactNode;
}) {
    return (
        <section
            id={id}
            aria-labelledby={`${id}-title`}
            className="scroll-mt-6 border-t border-line py-12 first:border-t-0 first:pt-0 lg:py-16"
        >
            <h2
                id={`${id}-title`}
                className="font-serif text-[1.75rem] font-normal leading-[1.15] tracking-[-0.02em] text-text sm:text-[2.25rem]"
            >
                {title}
            </h2>
            <div className="mt-6 flex max-w-[68ch] flex-col gap-5">{children}</div>
            {sources?.length ? (
                <p className={cn(MONO, 'mt-8 flex max-w-[68ch] flex-wrap gap-x-4 gap-y-1 text-xs text-faint')}>
                    <span>Checked against</span>
                    {sources.map((path) => (
                        <code key={path}>{path}</code>
                    ))}
                </p>
            ) : null}
        </section>
    );
}

/// A formula or worked figure, set apart in the mono face reserved for verifiable data.
function Formula({ children }: { children: ReactNode }) {
    return (
        <pre
            className={cn(
                MONO,
                'overflow-x-auto rounded-control border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-text',
            )}
        >
            {children}
        </pre>
    );
}

function Term({ children }: { children: ReactNode }) {
    return <code className={cn(MONO, 'rounded-control bg-raised px-1.5 py-0.5 text-[0.9em] text-text')}>{children}</code>;
}

export default function Docs() {
    const chain = chains[env.chainId];
    const vaultUrl = explorerAddressUrl(env.explorerUrl, env.addresses.vault);
    const settlementTokenUrl = explorerAddressUrl(env.explorerUrl, env.addresses.settlementToken);

    return (
        <div className="flex min-h-full flex-col">
            <div className={`${PAGE_FRAME} grid flex-1 gap-10 py-12 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 lg:py-20`}>
                <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
                    <p className="mb-3 text-sm text-faint">On this page</p>
                    <ol className="flex flex-wrap gap-x-5 gap-y-2 lg:flex-col lg:gap-y-1">
                        {SECTIONS.map((section) => (
                            <li key={section.id}>
                                <a href={`#${section.id}`} className={listLink}>
                                    {section.title}
                                </a>
                            </li>
                        ))}
                    </ol>
                </nav>

                <article className="min-w-0">
                    <header className="mb-12 max-w-[68ch] lg:mb-16">
                        <h1 className="font-serif text-[2.75rem] font-normal leading-[1.05] tracking-[-0.03em] text-text sm:text-[4rem]">
                            Documentation
                        </h1>
                        <p className={cn(bodyText, 'mt-5 text-xl')}>
                            How AlphaMarkets works, written from the deployed contracts. Each section names the source
                            files it was checked against. Fees, leverage and caps are read from the chain, not
                            written here.
                        </p>
                        <p
                            role="note"
                            className="mt-6 rounded-panel border border-line bg-surface p-5 text-base leading-relaxed text-muted"
                        >
                            <strong className="font-medium text-text">Live on {chain.name} mainnet.</strong>{' '}
                            Deposits, positions and payouts are real funds. Trade only what you can afford to lose,
                            and read <a href="#limits" className="text-accent underline underline-offset-4">Known limits</a>{' '}
                            before you deposit. See <a href="#network" className="text-accent underline underline-offset-4">Network and token</a>{' '}
                            for the chain, the settlement token and the protocol token address.
                        </p>
                    </header>

                    <Section
                        id="overview"
                        title="Overview"
                        sources={['core/AlphaMarketsVault.sol', 'core/MarketRegistry.sol']}
                    >
                        <p className={bodyText}>
                            AlphaMarkets trades perpetuals and options on tokenized stocks. Both products share one
                            vault, one market registry, one price router and one risk manager. There is no order book:
                            you trade against the vault at the oracle price.
                        </p>
                        <p className={bodyText}>
                            The vault is the only contract that holds tokens. It records each account&apos;s balance,
                            locks margin for open positions, and pays or collects profit and loss when a position
                            closes. Every contract is a proxy that an admin can upgrade, so the code behind an address
                            can change (see Known limits).
                        </p>
                    </Section>

                    <Section id="network" title="Network and token">
                        <p className={bodyText}>
                            AlphaMarkets runs on {chain.name} mainnet (chain ID <Term>{String(env.chainId)}</Term>), an
                            Ethereum L2. Gas is paid in ETH. Every contract address is listed in full under{' '}
                            <Link href="/#landing-contracts" className="text-accent underline underline-offset-4">
                                Smart contracts
                            </Link>{' '}
                            on the home page.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Settlement token.</strong> Margin, fees, profit
                            and loss and option premiums are all in USDG, which has 6 decimals.
                            {settlementTokenUrl ? (
                                <>
                                    {' '}
                                    <a
                                        href={settlementTokenUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent underline underline-offset-4"
                                    >
                                        View the token on the explorer
                                    </a>
                                    .
                                </>
                            ) : null}
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Markets.</strong> Each market is a tokenized
                            stock on the chain. Its price comes from a Chainlink data feed (see Price feeds). The
                            list of markets, and their leverage and limits, are under Live parameters.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Protocol token.</strong> The protocol token is
                            not one of the trading contracts, and trading does not need it. Check its contract
                            address here, and only against this page or the home page:
                        </p>
                        <ContractAddressBadge />
                    </Section>

                    <Section
                        id="start"
                        title="Deposit, trade, withdraw"
                        sources={['core/AlphaMarketsVault.sol', 'risk/CrossMarginManager.sol', 'risk/RiskManager.sol']}
                    >
                        <p className={bodyText}>
                            Deposit the settlement token into the vault first. The vault only accepts tokens the
                            collateral manager lists. Your available balance is your deposit, plus realized profit,
                            minus locked margin and fees.
                        </p>
                        <p className={bodyText}>
                            A trade needs the margin <em>and</em> the fee available at the same time. The fee is
                            charged on top of the margin, not taken out of it.
                        </p>
                        <p className={bodyText}>
                            You can withdraw any available balance at any time. If you hold a cross-margin position,
                            the vault refuses a withdrawal that would leave the account within 10% of its margin
                            requirement or below it.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">The pool.</strong> The vault is the other side
                            of every trade. It pays a winner from its pool: the tokens it holds beyond what it owes
                            users. Losses and fees add to the pool, and the team funds it at launch. A winner can
                            close while the losing side has not closed yet, so the pool covers that gap. If the pool
                            cannot cover a payout, the close reverts with <Term>InsufficientPoolReserves</Term> and the
                            position stays open. It closes once losing positions settle or the pool is topped up. To
                            keep this rare, each market also limits how far long and short open interest may differ,
                            and an order on the smaller side is never refused for that reason.
                        </p>
                    </Section>

                    <Section
                        id="perps"
                        title="Perpetuals"
                        sources={['perps/PerpsEngine.sol', 'risk/MarginEngine.sol', 'risk/RiskManager.sol']}
                    >
                        <p className={bodyText}>
                            A perpetual has no expiry. You choose long or short, the margin you put up, and a leverage
                            multiple. Position size is the margin times the leverage.
                        </p>
                        <Formula>{`size (notional)  = margin × leverage
initial margin   = size × initial margin rate
maintenance      = size × maintenance margin rate
PnL (long)       = size × (mark − entry) ÷ entry
PnL (short)      = size × (entry − mark) ÷ entry`}</Formula>
                        <p className={bodyText}>
                            Before a position opens, the risk manager checks three things. The leverage must be one of
                            the market&apos;s allowed tiers. The size must be under the per-position limit. The
                            market&apos;s total open interest must stay under its cap. If any check fails, the
                            transaction reverts and nothing is charged.
                        </p>
                        <p className={bodyText}>
                            The taker fee is a share of the position size, set per market. You choose a limit price
                            and a deadline on every market order. The order reverts if the oracle price is worse than
                            your limit, or if the deadline has passed. You can add margin or size to a position, reduce
                            it, or close it fully. A reduction charges the taker fee on the size removed.
                        </p>
                    </Section>

                    <Section
                        id="orders"
                        title="Limit, stop-loss and take-profit orders"
                        sources={['perps/PerpsEngine.sol', 'perps/PerpOrderManager.sol']}
                    >
                        <p className={bodyText}>
                            A <strong className="font-medium text-text">limit order</strong> opens a position when the
                            mark price reaches your price: at or below it for a long, at or above it for a short.
                            Margin and fee leave your balance when the order fills, not when you place it. Cancel an
                            open order at any time.
                        </p>
                        <p className={bodyText}>
                            A <strong className="font-medium text-text">stop-loss</strong> or{' '}
                            <strong className="font-medium text-text">take-profit</strong> closes an open position
                            when the mark price reaches your trigger. A long&apos;s stop-loss and a short&apos;s
                            take-profit fire when price falls to the trigger. The other two fire when price rises to
                            it. A trigger on the wrong side of the current price is rejected.
                        </p>
                        <p className={bodyText}>
                            Anyone can execute a limit or trigger order once its price is reached, and the protocol
                            does not run this for you. Orders are filled by a keeper service, so a fill can lag the
                            price. A trigger order has no slippage limit, because a stop-loss has to get out.
                        </p>
                    </Section>

                    <Section
                        id="liquidation"
                        title="Liquidation"
                        sources={['perps/LiquidationEngine.sol', 'risk/MarginEngine.sol']}
                    >
                        <p className={bodyText}>
                            A position is liquidatable when its margin ratio drops under the market&apos;s
                            maintenance margin rate.
                        </p>
                        <Formula>{`margin ratio      = (margin + unrealized PnL) ÷ size
liquidatable when = margin ratio < maintenance margin rate

liquidation price = entry ± entry × (maintenance − margin) ÷ size
                    (+ for a long, − for a short)`}</Formula>
                        <p className={bodyText}>
                            Anyone can liquidate an eligible position. The engine settles funding, releases the margin,
                            and settles the PnL. Then it takes two charges from what the owner has left: the
                            market&apos;s liquidation fee on position size, and a liquidator reward of 5% of the
                            position&apos;s margin. Together they are capped at the owner&apos;s remaining balance, so
                            a liquidation never reverts on a deeply losing position.
                        </p>
                        <p className={bodyText}>
                            If the loss is bigger than the owner&apos;s balance, the shortfall is covered in order:
                            other collateral in a cross account, then the insurance fund. Anything still uncovered is
                            emitted as a <Term>BadDebt</Term> event. Bad debt is recorded, not spread across other
                            users. In a cross account, only the worst position can be liquidated first.
                        </p>
                        <p className={bodyText}>
                            Nothing in the protocol itself calls liquidate, so a position stays open until someone
                            does.
                        </p>
                    </Section>

                    <Section
                        id="funding"
                        title="Funding"
                        sources={['perps/FundingManager.sol', 'oracle/OracleRouter.sol']}
                    >
                        <p className={bodyText}>
                            Funding is meant to keep the perpetual price near the index. Each interval (one hour by
                            default) the rate is set to the gap between mark and index price, capped at 1% per
                            interval by default. Longs pay shorts when the mark is above the index, and shorts pay
                            longs when it is below.
                        </p>
                        <Formula>{`rate (bps) = (mark − index) ÷ index × 10,000   (clamped)
payment    = size × change in cumulative rate ÷ 10,000`}</Formula>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Today the rate is always zero.</strong> The
                            oracle router returns the same price for mark and index, so there is no gap to charge. The
                            funding code runs but moves no money until a separate mark-price source exists.
                        </p>
                    </Section>

                    <Section
                        id="options"
                        title="Options"
                        sources={[
                            'options/OptionsEngine.sol',
                            'options/OptionSettlement.sol',
                            'options/OptionMarket.sol',
                        ]}
                    >
                        <p className={bodyText}>
                            Options are European, cash-settled calls and puts. You can only buy them. You pay a
                            premium, and your maximum loss is that premium plus the fee. There is no delivery of the
                            underlying token, only a payout in the settlement token.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Quotes.</strong> The premium is not computed
                            onchain. AlphaMarkets&apos; pricing service signs a quote for your exact trade, and the
                            contract checks that signature. A quote expires after a short time and works once. A
                            quote for a different account, strike or expiry is rejected. The price you pay is
                            therefore only as fair as that signer, and today it uses simple placeholder inputs.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Price bounds.</strong> The contract also checks
                            every signed premium against the market. When you open, it cannot be zero, cannot be below
                            the option&apos;s intrinsic value at the current price (2% is allowed for movement since
                            the quote), and cannot be above the value of the underlying. When you close, it cannot be
                            above that value. These bounds limit what a wrong or stolen quote can charge or pay; they
                            do not make the price fair inside the bounds. Opening an option needs a fresh oracle price.
                        </p>
                        <Formula>{`call payout = max(settlement − strike, 0) × contract size × contracts
put payout  = max(strike − settlement, 0) × contract size × contracts`}</Formula>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Limits.</strong> Every option you buy is checked
                            against the market&apos;s position size limit and open interest cap, and the fee is a
                            share of the premium.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Closing early.</strong> Before expiry you can sell
                            the position back at a signed close quote. The close fee is a share of that premium.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Expiry.</strong> Once a series expires, anyone can
                            settle it. The first valid oracle price at or after expiry is recorded and never changes.
                            An in-the-money option pays the formula above minus the settlement fee. An
                            out-of-the-money option pays nothing. The app alerts you when an option of yours has
                            expired, and gives you a Settle button.
                        </p>
                        <p className={bodyText}>
                            A series settles 50 positions per call, so a large series is finished over several calls.
                            You never wait for that: you can settle your own position at once, whatever else is in its
                            series, and the Settle button does exactly that.
                        </p>
                        <p className={bodyText}>
                            The default contract size is one underlying token. Strikes and expiries are chosen by the
                            app, so the contract has no fixed list of them.
                        </p>
                    </Section>

                    <Section
                        id="oracle"
                        title="Price feeds"
                        sources={['oracle/OracleRouter.sol', 'oracle/PriceValidator.sol']}
                    >
                        <p className={bodyText}>
                            Every contract reads prices through the oracle router, in 18 decimals. Each market has a
                            primary feed and an optional fallback. A price older than the maximum age (one hour by
                            default) is rejected, and the trade reverts. If both feeds work, they must agree within
                            10% (default), or the read reverts. If only one works, its price is used.
                        </p>
                        <p className={bodyText}>
                            A pauser key can pause a market&apos;s oracle. While it is paused, every read for that
                            market reverts, which blocks opening, closing, liquidation and settlement there.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Pausing.</strong> A pauser key can also stop new
                            trading in one market, or in every market at once. Closing positions, liquidation and
                            settlement keep working when trading is stopped. The pauser cannot turn anything back on,
                            or change a price source or a limit: only the admin can, so a stolen pauser key can stop
                            trading but not take funds.
                        </p>
                        <p className={bodyText}>
                            <strong className="font-medium text-text">Chainlink feeds.</strong> Prices come from
                            Chainlink data feeds on {chain.name}, which report each token&apos;s price with 8
                            decimals. The router converts them to 18. Stock feeds update on the equity market
                            schedule, 24 hours a day, 5 days a week. When a feed has not updated within the maximum
                            age, reads for that market revert. Opening, closing, liquidation and settlement wait
                            for the next fresh price. An option that expires in that window settles at the first
                            valid price after expiry.
                        </p>
                    </Section>

                    <Section id="parameters" title="Live parameters">
                        <p className={bodyText}>
                            These figures are read from the risk and fee contracts now. Basis point values are shown as
                            percentages. Amounts are in the settlement token. An admin can change them, so treat this
                            table, not any other page, as current.
                        </p>
                    </Section>
                    <div className="-mt-6 mb-16 lg:-mt-10 lg:mb-20">
                        <DocsLiveParameters />
                    </div>

                    <Section id="limits" title="Known limits">
                        <ul className={cn(bodyText, 'flex list-disc flex-col gap-3 pl-5 marker:text-faint')}>
                            <li>
                                <strong className="font-medium text-text">Upgradeable contracts.</strong> Every
                                contract is a proxy that an admin can upgrade, so the code behind an address can
                                change. Read the current values under Live parameters.
                            </li>
                            <li>
                                <strong className="font-medium text-text">Market hours.</strong> Stock prices update
                                24 hours a day, 5 days a week. While a feed is stale, its market cannot open, close
                                or liquidate positions.
                            </li>
                            <li>
                                <strong className="font-medium text-text">Pool size.</strong> Options are buy-only and
                                the vault pool pays winners. If the pool runs low, winning closes wait until losing
                                positions settle or the pool is topped up (see The pool).
                            </li>
                            <li>
                                <strong className="font-medium text-text">Quote signer.</strong> One signing service
                                sets option premiums. The contract bounds them, but the signer can still choose any
                                premium inside the bounds.
                            </li>
                            <li>
                                <strong className="font-medium text-text">Funding is inactive</strong>, as described
                                above.
                            </li>
                            <li>
                                <strong className="font-medium text-text">Alerts need an open tab.</strong> Take-profit,
                                stop-loss, liquidation and expiry alerts appear only while the app is open in your
                                browser.
                            </li>
                        </ul>
                    </Section>

                    <Section id="verify" title="Verify it yourself">
                        <p className={bodyText}>
                            Do not rely on this page alone. Every contract address, in full, is listed under{' '}
                            <Link href="/#landing-contracts" className="text-accent underline underline-offset-4">
                                Smart contracts
                            </Link>{' '}
                            on the home page, with a link to the block explorer.
                            {vaultUrl ? (
                                <>
                                    {' '}
                                    Start with the{' '}
                                    <a
                                        href={vaultUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent underline underline-offset-4"
                                    >
                                        vault
                                    </a>
                                    , which holds all deposited funds.
                                </>
                            ) : null}
                        </p>
                        <p className={bodyText}>
                            If this page and the chain disagree, the chain is right. Tell us and we will correct the
                            page.
                        </p>
                    </Section>
                </article>
            </div>
            <Footer />
        </div>
    );
}
