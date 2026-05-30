/**
 * Small keyboard-shortcut pill, shared across composer surfaces.
 *
 * Two pieces:
 *   - `<Kbd>` — one key cap (a `<kbd>` element styled as a soft border
 *               + muted bg pill).
 *   - `<ComposerKbdHints>` — pre-styled row of hint pairs (key cap +
 *                            short label, separated by a centered dot),
 *                            for use in `Composer.extrasBelow`.
 *
 * Keeping both here so every surface (main `<SidePanelView />`, the
 * Quick-Ask Spotlight popup, `<ChatView />`) uses the same caption row
 * without forking the styling.
 */
import { cn } from "@hermes-x/utils"
import type { ReactNode } from "react"

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted/40 px-1 font-sans text-[10px] text-foreground/80">
      {children}
    </kbd>
  )
}

/** One hint entry — a key cap + a short label. */
export interface ComposerKbdHint {
  /** Key cap content (e.g. "⏎", "⇧⏎", "⌘K"). */
  keys: ReactNode
  /** Verb describing what the chord does (e.g. "send", "newline"). */
  label: ReactNode
}

/**
 * Render a single row of keyboard hints. Used inside
 * `Composer.extrasBelow`. Pass `right` to split the row into
 * left-side and right-side groups (e.g. left = "send / newline",
 * right = "esc to dismiss") for surfaces with a primary + secondary
 * action.
 */
export function ComposerKbdHints({
  hints,
  right,
  className,
}: {
  hints: ComposerKbdHint[]
  right?: ComposerKbdHint[]
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 text-[10px]",
        className,
      )}
    >
      <KbdHintRow hints={hints} />
      {right && right.length > 0 ? <KbdHintRow hints={right} /> : null}
    </div>
  )
}

function KbdHintRow({ hints }: { hints: ComposerKbdHint[] }) {
  return (
    <span className="flex items-center gap-1.5">
      {hints.map((h, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <Kbd>{h.keys}</Kbd>
          <span>{h.label}</span>
          {i < hints.length - 1 ? <span>·</span> : null}
        </span>
      ))}
    </span>
  )
}
