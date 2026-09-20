import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  actions?: ReactNode;
}

/// A bordered region of the terminal. Borders, not shadows or fills, separate regions.
export function Panel({ title, actions, className, children, ...props }: PanelProps) {
  return (
    <section className={cn("flex min-h-0 flex-col border border-line bg-surface", className)} {...props}>
      {title || actions ? (
        <header className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 border-b border-line px-3">
          <h2 className="min-w-0 max-w-full text-sm font-medium">{title}</h2>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
