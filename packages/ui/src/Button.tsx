import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "up" | "down";

const variants: Record<ButtonVariant, string> = {
  // The primary action inverts the page: off-white on black. No accent colour.
  primary: "bg-text text-ground hover:bg-text/85 disabled:bg-line disabled:text-faint",
  secondary: "border border-line text-text hover:border-faint hover:bg-raised disabled:text-faint disabled:hover:border-line disabled:hover:bg-transparent",
  ghost: "text-muted hover:text-text disabled:text-faint",
  up: "bg-up text-ground hover:bg-up/85 disabled:bg-line disabled:text-faint",
  down: "bg-down text-ground hover:bg-down/85 disabled:bg-line disabled:text-faint",
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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
