import { cn } from "@alphamarkets/ui";
import { CONTRACTS } from "@/lib/contracts";
import { env } from "@/lib/env";
import { explorerAddressUrl } from "@/lib/explorer";
import { MONO, PAGE_FRAME } from "@/lib/frame";
import { shortHash } from "@/lib/format";
import { ArrowIcon } from "./ArrowIcon";
import { SectionHeader } from "./SectionHeader";

/// The venue's own contracts, so a reader can verify them directly instead of taking custody and
/// settlement on trust — the same hairline-divided figure grid `LandingStats` uses, not the
/// terminal's rounded `Panel` card, so this stays part of the page's own visual language rather
/// than importing a separate "card" system. A contract with no configured address says so rather
/// than linking nowhere, same discipline as the footer's own contracts list.
export function LandingContracts() {
  return (
    <section aria-labelledby="landing-contracts" className="py-16 lg:py-24">
      <SectionHeader id="landing-contracts" title="Smart contracts">
        <p className="mt-3 max-w-[52ch] text-lg leading-relaxed text-muted">
          Every contract is public. Collateral, positions and settlement are
          checkable onchain, not taken on trust.
        </p>
      </SectionHeader>
      {/* Same fixed 4-up hairline grid `LandingStats` uses (grid-cols-2 -> sm:grid-cols-4, with a
          border only between cells) — matched cell for cell so the two grids read as one device. */}
      <div className={cn(PAGE_FRAME, "mt-4 border-b border-line lg:mt-6")}>
        <div className="grid grid-cols-2 sm:grid-cols-4">
          {CONTRACTS.map(({ label, address }, index) => {
            const url = address ? explorerAddressUrl(env.explorerUrl, address) : undefined;
            const border = [
              "",
              "border-l border-line pl-4 sm:pl-6",
              "max-sm:border-t max-sm:border-line sm:border-l sm:border-line sm:pl-6",
              "border-l border-line pl-4 max-sm:border-t sm:pl-6",
            ][index];
            return (
              <div key={label} className={cn("flex min-w-0 flex-col gap-3 py-6 sm:py-10", border)}>
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", url ? "bg-up" : "bg-faint")} />
                  {label}
                </span>
                {url && address ? (
                  <a href={url} target="_blank" rel="noreferrer" className={cn(MONO, "inline-flex w-fit items-center gap-1.5 text-lg text-text hover:text-accent")}>
                    {shortHash(address)}
                    <ArrowIcon />
                  </a>
                ) : (
                  <span className={cn(MONO, "text-lg text-faint")}>Not yet deployed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
