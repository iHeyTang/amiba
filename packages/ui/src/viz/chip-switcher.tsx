/**
 * ChipSwitcher — generic segmented-control chip strip.
 *
 * Used by extensions that need a small "show me the N w / N d / N m"
 * selector that doesn't justify a full Select dropdown. Borrowed from
 * the token-meter extension's heatmap range picker, lifted here so
 * other extensions can drop it in without duplicating the styling.
 */

import { cn } from "../primitives"

export interface ChipSwitcherProps<T extends string | number> {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  /** Renderer for each chip's label — kept as a function so callers can
   *  apply i18n / pluralization without the component reaching into
   *  any catalog itself. */
  formatLabel: (v: T) => string
  className?: string
}

export function ChipSwitcher<T extends string | number>({
  options,
  value,
  onChange,
  formatLabel,
  className,
}: ChipSwitcherProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-border/50 bg-muted/30 p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {formatLabel(opt)}
          </button>
        )
      })}
    </div>
  )
}
