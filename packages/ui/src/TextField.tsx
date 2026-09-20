import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn.js";

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> {
  label: string;
  onValueChange: (value: string) => void;
  suffix?: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
}

export function TextField({ label, onValueChange, suffix, hint, invalid, className, id, ...props }: TextFieldProps) {
  const inputId = id ?? `field-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs text-muted">
          {label}
        </label>
        {hint ? <span className="text-xs text-muted">{hint}</span> : null}
      </div>
      <div
        className={cn(
          "flex h-10 items-center rounded-md border bg-ground px-3 focus-within:border-accent",
          invalid ? "border-down" : "border-line",
        )}
      >
        <input
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onValueChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-right text-sm tabular-nums outline-none placeholder:text-faint"
          {...props}
        />
        {suffix ? <span className="ml-2 text-xs text-muted">{suffix}</span> : null}
      </div>
    </div>
  );
}
