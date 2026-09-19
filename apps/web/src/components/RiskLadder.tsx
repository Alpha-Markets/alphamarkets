import { cn } from "@orionis/ui";
import { formatUnits } from "viem";
import { PRICE_DECIMALS } from "@/lib/format";

const LADDER_HEIGHT = 96;
const ROW_HEIGHT = 22;

const toNumber = (value: bigint) => Number(formatUnits(value, PRICE_DECIMALS));

/// Shows where the position would be liquidated relative to where it enters and the worst price
/// the order will accept — the distance to liquidation, which is the number that matters before
/// signing (PROJECT_BRIEF.md Section 45). Higher prices sit higher on the ladder.
export function RiskLadder({
  isLong,
  entry,
  liquidation,
  worst,
}: {
  isLong: boolean;
  entry: bigint;
  liquidation: bigint;
  worst: bigint;
}) {
  const marks = [
    { key: "entry", label: "Entry", price: toNumber(entry), tone: "text-text", bar: "bg-text" },
    { key: "worst", label: "Worst fill", price: toNumber(worst), tone: "text-muted", bar: "bg-faint" },
    { key: "liq", label: "Liquidation", price: toNumber(liquidation), tone: "text-down", bar: "bg-down" },
  ];
  // Place each mark by price, then push overlapping labels apart so close prices (entry and the
  // worst accepted fill are often within a fraction of a percent) stay readable.
  const prices = marks.map((mark) => mark.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max * 0.01 || 1;
  const usable = LADDER_HEIGHT - ROW_HEIGHT;
  const placed = [...marks]
    .sort((a, b) => b.price - a.price)
    .map((mark) => ({ ...mark, y: ((max - mark.price) / span) * usable }));
  for (let index = 1; index < placed.length; index++) {
    placed[index]!.y = Math.max(placed[index]!.y, placed[index - 1]!.y + ROW_HEIGHT);
  }
  const height = Math.max(LADDER_HEIGHT, (placed.at(-1)?.y ?? 0) + ROW_HEIGHT);

  const entryNumber = toNumber(entry);
  const distance = entryNumber === 0 ? 0 : (Math.abs(entryNumber - toNumber(liquidation)) / entryNumber) * 100;
  const direction = isLong ? "below" : "above";

  return (
    <figure aria-label="Distance to liquidation" className="border border-line p-3">
      <div className="relative mx-2" style={{ height }}>
        {placed.map((mark) => (
          <div key={mark.key} className="absolute left-0 right-0" style={{ top: mark.y }}>
            <div className="flex items-center gap-2">
              <span className={cn("w-20 shrink-0 text-right text-xs", mark.tone)}>{mark.label}</span>
              <span className={cn("h-px w-3 shrink-0", mark.bar)} />
              <span className={cn("text-xs tabular-nums", mark.tone)}>{mark.price.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-3 text-xs text-muted">
        Liquidation is <span className="tabular-nums text-text">{distance.toFixed(1)}%</span> {direction} the entry price.
      </figcaption>
    </figure>
  );
}
