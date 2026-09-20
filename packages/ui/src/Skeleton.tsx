import type { HTMLAttributes } from "react";
import { cn } from "./cn.js";

/// A placeholder block that holds the space a figure will take, so a panel does not jump when its
/// data arrives. The pulse stops under `prefers-reduced-motion` (see globals.css).
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" className={cn("inline-block h-[1em] min-w-8 animate-pulse rounded-[2px] bg-raised align-middle", className)} {...props} />;
}
