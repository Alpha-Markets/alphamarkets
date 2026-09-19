import { formatUnits } from "viem";

/// Display-only formatting. Figures stay `bigint` everywhere else; they become a `number` only
/// here, at the last step before rendering.
const cache = new Map<string, Intl.NumberFormat>();
function formatter(min: number, max: number) {
  const key = `${min}-${max}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
    cache.set(key, f);
  }
  return f;
}

export const PRICE_DECIMALS = 18;

export function fmt(value: bigint | undefined, decimals: number, digits = 2): string {
  if (value === undefined) return "–";
  return formatter(digits, digits).format(Number(formatUnits(value, decimals)));
}

export const fmtPrice = (value: bigint | undefined) => fmt(value, PRICE_DECIMALS, 2);

export function fmtUsd(value: bigint | undefined, decimals: number, digits = 2): string {
  if (value === undefined) return "–";
  return `$${fmt(value, decimals, digits)}`;
}

export function fmtSigned(value: bigint | undefined, decimals: number, digits = 2): string {
  if (value === undefined) return "–";
  const text = fmt(value < 0n ? -value : value, decimals, digits);
  return `${value < 0n ? "−" : value > 0n ? "+" : ""}$${text}`;
}

/// Basis points as a percentage: 8 -> "0.08%".
export function fmtBps(bps: bigint | undefined): string {
  if (bps === undefined) return "–";
  return `${formatter(2, 4).format(Number(bps) / 100)}%`;
}

export function fmtCountdown(targetSeconds: bigint, nowMs: number): string {
  const remaining = Math.max(0, Number(targetSeconds) - Math.floor(nowMs / 1000));
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

export function shortHash(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
