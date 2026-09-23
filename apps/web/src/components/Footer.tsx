import { chains } from '@alphamarkets/config';
import Link from 'next/link';
import { env } from '@/lib/env';
import { PAGE_FRAME } from '@/lib/frame';
import { X_URL } from '@/lib/social';
import { listLink } from '@alphamarkets/ui';
import { Logo } from './Logo';
import { StatusBadge } from './StatusBadge';
import { XIcon } from './XIcon';

/// One slim line, not a block of columns: the brand on the left, everything else — product links, a
/// way back up to Smart contracts (which already lists every address in full, so the footer doesn't
/// repeat that list), the chain status and the X link — spaced out on the right. Wraps and centres on
/// a phone the same way the rest of this file's rows do.
export function Footer() {
    return (
        <footer className="border-t border-line bg-surface">
            <div
                className={`${PAGE_FRAME} flex flex-wrap items-center justify-center gap-x-6 gap-y-3 py-6 sm:justify-between`}
            >
                <div className="flex items-center gap-3">
                    <Logo />
                    <p className="text-muted">
                        Onchain Derivatives for Stock Tokens.
                    </p>
                </div>
                <nav
                    aria-label="Footer"
                    className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
                >
                    <Link href="/markets" className={listLink}>
                        Markets
                    </Link>
                    <Link href="/options" className={listLink}>
                        Options
                    </Link>
                    <Link href="/perpetuals" className={listLink}>
                        Perpetuals
                    </Link>
                    <Link href="/portfolio" className={listLink}>
                        Portfolio
                    </Link>
                    <a href="#landing-contracts" className={listLink}>
                        Smart contracts
                    </a>
                    <StatusBadge label={chains[env.chainId].name} />
                    <a
                        href={X_URL}
                        target="_blank"
                        rel="noreferrer"
                        className={`${listLink} items-center gap-2`}
                    >
                        <XIcon />
                        Follow on X
                    </a>
                </nav>
            </div>
        </footer>
    );
}
