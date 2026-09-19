import { cn } from "./cn.js";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /// Colour the active segment to encode market direction (long/short) instead of neutral.
  activeTone?: (value: T) => "up" | "down" | "neutral";
  className?: string;
}

const active = { up: "bg-up text-ground", down: "bg-down text-ground", neutral: "bg-text text-ground" };

export function Segmented<T extends string | number>({ options, value, onChange, label, activeTone, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex gap-px rounded-[3px] bg-line p-px", className)}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 flex-1 px-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:text-faint",
              selected ? active[activeTone?.(option.value) ?? "neutral"] : "bg-surface text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
