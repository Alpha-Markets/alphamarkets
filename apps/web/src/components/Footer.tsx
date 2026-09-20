import { chains } from "@orionis/config";
import Link from "next/link";
import { env } from "@/lib/env";
import { PAGE_FRAME } from "@/lib/frame";

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
    <footer className="border-t border-line">
      <div className={`${PAGE_FRAME} grid gap-8 py-8 sm:grid-cols-[1fr_auto_auto]`}>
        <div>
          <p className="text-sm font-medium tracking-[0.32em]">ORIONIS</p>
          <p className="mt-2 max-w-xs text-muted">Derivatives for tokenized equities.</p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-line px-2 py-1 text-xs text-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-up" />
            {chains[env.chainId].name}
          </p>
        </div>
        <nav aria-label="Product" className="flex flex-col gap-2">
          <p className="text-xs text-muted">Product</p>
          <Link href="/markets" className="hover:underline">Markets</Link>
          <Link href="/options" className="hover:underline">Options</Link>
          <Link href="/perpetuals" className="hover:underline">Perpetuals</Link>
          <Link href="/portfolio" className="hover:underline">Portfolio</Link>
        </nav>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">Contracts</p>
          {contracts.map(({ label, address }) => {
            const url = address ? explorerAddress(address) : undefined;
            return url ? (
              <a key={label} href={url} target="_blank" rel="noreferrer" className="hover:underline">
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
    </footer>
  );
}
