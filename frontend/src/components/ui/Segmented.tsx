import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
}

/**
 * Segmented control (mis. pemilih timeframe). Pakai `aria-pressed`, bukan
 * `role="radio"`, supaya Tab antar opsi tetap jalan tanpa harus menambah navigasi panah.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5",
              selected ? "bg-surface font-medium text-fg" : "text-fg-muted hover:text-fg",
              option.disabled && "cursor-not-allowed opacity-45",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
