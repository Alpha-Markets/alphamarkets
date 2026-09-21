import { chains } from "@alphamarkets/config";
import Link from "next/link";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { PAGE_FRAME } from "@/lib/frame";
import { X_URL } from "@/lib/social";
import { listLink } from "@alphamarkets/ui";
import { Logo } from "./Logo";
import { XIcon } from "./XIcon";

const contracts = [
  { label: "Market registry", address: env.addresses.marketRegistry },
  { label: "Vault", address: env.addresses.vault },
  { label: "Perps engine", address: env.addresses.perpsEngine },
  { label: "Options engine", address: env.addresses.optionsEngine },
];

/// Where the product lives on chain: the network it runs on and the contracts that hold collateral
/// and settle trades, each linked to the explorer when one is configured.
export function Footer() {
  return (
    <footer>
      {/* The name, set as large as the page allows: sans for "Alpha", serif italic for "markets". The
          block is cropped so the "p" descender runs into the footer below, as on the reference. */}
      <div aria-hidden="true" className="paper overflow-hidden">
        <div className={`${PAGE_FRAME} @container`}>
          <p className="h-[18.6cqw] select-none whitespace-nowrap pt-[2.2cqw] text-[19cqw] leading-[0.8] tracking-[-0.045em]">
            <span className="font-light">Alpha</span>
            <span className="font-serif font-light italic tracking-[-0.03em]">markets</span>
          </p>
        </div>
      </div>
      <div className="bg-ink text-[#eef4f2]">
        <div className={`${PAGE_FRAME} grid gap-8 py-12 sm:grid-cols-[1fr_auto_auto] sm:gap-x-24`}>
          <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
            <Logo size="lg" />
            <p className="mt-2 max-w-xs text-muted">Derivatives for tokenized equities.</p>
            <p className="mt-4 flex w-fit items-center gap-2 rounded-md border border-line px-2 py-1 text-xs text-muted">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
              {chains[env.chainId].name}
            </p>
            <a href={X_URL} target="_blank" rel="noreferrer" className={`${listLink} mt-3 items-center gap-2`}>
              <XIcon />
              Follow on X
            </a>
          </div>
          <nav aria-label="Product" className="flex flex-col items-center gap-2 sm:items-start">
            <p className="text-xs text-muted">Product</p>
            <Link href="/markets" className={listLink}>Markets</Link>
            <Link href="/options" className={listLink}>Options</Link>
            <Link href="/perpetuals" className={listLink}>Perpetuals</Link>
            <Link href="/portfolio" className={listLink}>Portfolio</Link>
          </nav>
          <div className="flex flex-col items-center gap-2 sm:items-start">
            <p className="text-xs text-muted">Contracts</p>
            {contracts.map(({ label, address }) => {
              const url = address ? explorerAddressUrl(env.explorerUrl, address) : undefined;
              return url ? (
                <a key={label} href={url} target="_blank" rel="noreferrer" className={listLink}>
                  {label}
                </a>
              ) : (
                <span key={label} className="text-muted">
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}
