import { cn } from "@alphamarkets/ui";
import { MONO } from "@/lib/frame";

/// A small bordered pill with a glowing dot: "this is live" or "this checks out", read at a glance
/// across the landing page's card sections (Products, Smart contracts) instead of a different status
/// convention per section.
export function StatusBadge({ label, tone = "up" }: { label: string; tone?: "up" | "faint" }) {
  return (
    <span
      className={cn(
        MONO,
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-line px-2 py-1 text-[11px] uppercase tracking-[0.08em]",
        tone === "up" ? "text-up" : "text-faint",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", tone === "up" ? "bg-up shadow-[0_0_6px_var(--color-up)]" : "bg-faint")}
      />
      {label}
    </span>
  );
}
