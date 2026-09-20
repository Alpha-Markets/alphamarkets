import { cn } from "./cn.js";

export interface TabOption<T extends string> {
  id: T;
  label: string;
}

/// A row of section tabs for a panel header. It scrolls sideways instead of wrapping when the
/// screen is too narrow for every label.
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex h-9 max-w-full gap-5 overflow-x-auto whitespace-nowrap", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "h-9 shrink-0 border-b-2 px-0.5 text-sm font-medium",
            value === tab.id ? "border-text text-text" : "border-transparent text-muted hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
