import Link from "next/link";
import { WalletButton } from "./WalletButton";

/// PROJECT_BRIEF.md Section 22. Pages that are not built yet show as plain text rather than
/// links that lead nowhere.
const items = [
  { label: "Markets", href: undefined },
  { label: "Options", href: undefined },
  { label: "Perpetuals", href: "/perpetuals" },
  { label: "Portfolio", href: undefined },
  { label: "Activity", href: undefined },
];

export function Header({ current }: { current?: string }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-sm font-medium tracking-[0.32em]">
          ORIONIS
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5 text-sm">
          {items.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                aria-current={current === item.label ? "page" : undefined}
                className={current === item.label ? "text-text" : "text-muted hover:text-text"}
              >
                {item.label}
              </Link>
            ) : (
              <span key={item.label} aria-disabled="true" title="Not available yet" className="cursor-default text-faint">
                {item.label}
              </span>
            ),
          )}
        </nav>
      </div>
      <WalletButton />
    </header>
  );
}
