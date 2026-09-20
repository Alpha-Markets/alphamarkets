import type { ReactNode } from "react";

/// The title of a page that is not a terminal: what this page is, and one line on what to do here.
export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <div>
        <h1 className="text-title font-medium">{title}</h1>
        {children ? <p className="mt-0.5 max-w-prose text-muted">{children}</p> : null}
      </div>
      {actions}
    </div>
  );
}
