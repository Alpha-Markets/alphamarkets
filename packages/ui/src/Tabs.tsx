import { cn } from "./cn.js";
import { pill } from "./interaction.js";

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
    <div role="tablist" aria-label={label} className={cn("flex h-11 max-w-full items-center gap-1.5 overflow-x-auto whitespace-nowrap px-0.5", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn("h-8 shrink-0 px-3 text-sm", pill(value === tab.id))}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
