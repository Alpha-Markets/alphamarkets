import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

export type Tone = "neutral" | "up" | "down" | "muted";

const tones: Record<Tone, string> = { neutral: "text-text", up: "text-up", down: "text-down", muted: "text-muted" };

/// Tabular numerals so columns of figures line up and digits do not jitter as prices tick.
export function Num({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("tabular-nums", tones[tone], className)} {...props} />;
}

export function toneOf(value: bigint | number): Tone {
  return value > 0 ? "up" : value < 0 ? "down" : "neutral";
}
