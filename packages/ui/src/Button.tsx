import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "up" | "down";

/// Every variant is a solid fill. Hover brightens the fill and adds a soft ring; pressed goes darker.
/// There is deliberately no outline-only or text-only variant.
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover hover:shadow-[0_0_0_3px_var(--color-accent-line)] active:bg-accent-press active:shadow-none disabled:bg-line disabled:text-faint disabled:shadow-none",
  secondary:
    "border border-line bg-raised text-text hover:border-accent hover:bg-accent-soft hover:text-accent active:border-accent active:bg-accent active:text-accent-ink disabled:border-line disabled:bg-raised disabled:text-faint",
  up: "bg-up text-ground hover:bg-up-hover hover:shadow-[0_0_0_3px_rgb(114_217_119/0.35)] active:bg-up-press active:shadow-none disabled:bg-line disabled:text-faint disabled:shadow-none",
  down: "bg-down text-ground hover:bg-down-hover hover:shadow-[0_0_0_3px_rgb(238_112_105/0.35)] active:bg-down-press active:shadow-none disabled:bg-line disabled:text-faint disabled:shadow-none",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
