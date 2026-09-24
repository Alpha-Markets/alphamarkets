'use client';

import { cn } from '@alphamarkets/ui';
import { useState } from 'react';
import { env } from '@/lib/env';
import { explorerAddressUrl } from '@/lib/explorer';
import { MONO } from '@/lib/frame';
import { ArrowIcon } from './ArrowIcon';

function CopyIcon({ copied }: { copied: boolean }) {
    return copied ? (
        <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            className="size-3 shrink-0"
        >
            <path
                d="M2.5 6.5l2.4 2.4L9.5 3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    ) : (
        <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            className="size-3 shrink-0"
        >
            <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
            <path d="M1.5 8.5v-6a1 1 0 0 1 1-1h6" />
        </svg>
    );
}

/// An always-visible pointer to the settlement token's full contract address — for the hero and
/// footer, where `LandingContracts` full address list (`#landing-contracts`) would be too much: a
/// trader skimming the top or bottom of the page should still be able to read and verify the CA
/// without scrolling to the contracts section. Shown in full, `break-all` (matching `ContractCard`
/// there): a partial address isn't something a reader can actually verify against the explorer.
export function ContractAddressBadge({ className }: { className?: string }) {
    const [copied, setCopied] = useState(false);
    const address = env.addresses.settlementToken;
    const url = explorerAddressUrl(env.explorerUrl, address);

    return (
        <div
            className={cn(
                'inline-flex max-w-full flex-wrap items-center gap-2 rounded-control border border-line bg-surface px-3 py-1.5',
                className,
            )}
        >
            <span className={cn(MONO, 'text-xs text-muted')}>CA</span>
            <span className={cn(MONO, 'break-all text-xs text-text')}>
                Coming Soon
            </span>
            <button
                type="button"
                aria-label={copied ? 'Address copied' : 'Copy CA address'}
                onClick={() => {
                    void navigator.clipboard?.writeText(address).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                    });
                }}
                className={cn(
                    'shrink-0 rounded-control p-0.5 text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-accent',
                    copied && 'text-up',
                )}
            >
                <CopyIcon copied={copied} />
            </button>
            {url ? (
                <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View CA on the explorer"
                    className="shrink-0 rounded-control p-0.5 text-muted transition-colors duration-150 hover:bg-accent-soft hover:text-accent"
                >
                    <ArrowIcon className="size-3" />
                </a>
            ) : null}
        </div>
    );
}
