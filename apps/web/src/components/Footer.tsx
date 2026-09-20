import { chains } from "@alphamarkets/config";
import Link from "next/link";
import { env } from "@/lib/env";
import { PAGE_FRAME } from "@/lib/frame";
import { listLink } from "@alphamarkets/ui";
import { Logo } from "./Logo";

const explorerAddress = (address: string) => (env.explorerUrl ? `${env.explorerUrl.replace(/\/+$/, "")}/address/${address}` : undefined);

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
          <div>
            <Logo size="lg" />
            <p className="mt-2 max-w-xs text-muted">Derivatives for tokenized equities.</p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-line px-2 py-1 text-xs text-muted">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
              {chains[env.chainId].name}
            </p>
          </div>
          <nav aria-label="Product" className="flex flex-col gap-2">
            <p className="text-xs text-muted">Product</p>
            <Link href="/markets" className={listLink}>Markets</Link>
            <Link href="/options" className={listLink}>Options</Link>
            <Link href="/perpetuals" className={listLink}>Perpetuals</Link>
            <Link href="/portfolio" className={listLink}>Portfolio</Link>
          </nav>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">Contracts</p>
            {contracts.map(({ label, address }) => {
              const url = address ? explorerAddress(address) : undefined;
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
