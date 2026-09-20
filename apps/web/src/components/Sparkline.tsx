import { cn } from "@alphamarkets/ui";

/// A price line with no axes, in the market's direction colour. Enough points to see the shape of
/// the day; the figures next to it carry the numbers.
export function Sparkline({ points, className }: { points: number[]; className?: string }) {
  if (points.length < 2) return <span aria-hidden="true" className={className} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points.map((price, index) => `${(index / (points.length - 1)) * 100},${30 - ((price - min) / span) * 28}`).join(" ");
  const rising = points[points.length - 1]! >= points[0]!;
  return (
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={rising ? "Price is up over the day" : "Price is down over the day"} className={cn(rising ? "text-up" : "text-down", className)}>
      <polyline points={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
