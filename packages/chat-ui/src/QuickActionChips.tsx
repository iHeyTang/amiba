/**
 * Quick-action chip strip. Single implementation shared by every
 * surface that exposes the composer's template-driven shortcuts —
 * `HomeView`'s composer card, the Quick-Ask Spotlight popup, and any
 * future surface that wants the same "translate / summarize / polish /
 * explain (+ custom)" affordance.
 *
 * Open/closed: the chip styling, role/label, IME-safe click semantics,
 * and disabled-state visuals are owned here; consumers supply only the
 * resolved action list + a click handler + a "can apply" gate.
 */
import type { ResolvedQuickAction } from "@hermes-x/core"
import { useT } from "@hermes-x/i18n"
import { cn } from "@hermes-x/utils"
import { Sparkles } from "lucide-react"

export interface QuickActionChipsProps {
  actions: ResolvedQuickAction[]
  /** True when the composer has text (or other payload) the action can wrap. */
  canApply: boolean
  /** Optional tooltip shown when `canApply` is false. */
  emptyTooltip?: string
  onApply(action: ResolvedQuickAction): void
  className?: string
}

export function QuickActionChips({
  actions,
  canApply,
  emptyTooltip,
  onApply,
  className,
}: QuickActionChipsProps) {
  const { t } = useT()
  if (actions.length === 0) return null
  const disabled = !canApply
  return (
    <div
      role="toolbar"
      aria-label={t("composer.quick.empty.tooltip")}
      className={cn("flex min-w-0 gap-1 overflow-x-auto", className)}
    >
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => onApply(action)}
          disabled={disabled}
          title={
            disabled
              ? emptyTooltip ?? t("composer.quick.empty.tooltip")
              : action.tooltip
          }
          className={cn(
            "inline-flex h-6 shrink-0 select-none items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            disabled
              ? "cursor-not-allowed border-foreground/10 bg-transparent text-foreground/35"
              : "cursor-pointer border-foreground/15 bg-background/60 text-foreground/80 hover:bg-foreground/10 hover:text-foreground",
          )}
        >
          <Sparkles className="h-3 w-3" />
          <span className="max-w-[10rem] truncate">{action.label}</span>
        </button>
      ))}
    </div>
  )
}
