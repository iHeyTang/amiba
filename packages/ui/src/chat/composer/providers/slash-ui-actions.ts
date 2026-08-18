/** The small set of commands that map to a native UI action instead of being
 *  sent as text. Everything else defaults to kind:'send'. Host wires handlers. */
export type SlashKind = "send" | "ui-action"

export interface SlashUiActionContext {
  openSettings?: () => void
}

// These are MANUALLY-TYPED client UI actions: a `/name` the user can type to
// trigger a native UI surface instead of sending text. They are NOT
// guaranteed to appear in the runtime-driven DSH commands menu — e.g.
// `config` is `cli_only` server-side, so it won't show up in that menu but is
// still handled here when typed.
export const UI_ACTION_NAMES = new Set<string>([
  // Extend as native UI surfaces are added. Keep tiny.
  "config",
])

export function slashKindFor(name: string): SlashKind {
  return UI_ACTION_NAMES.has(name) ? "ui-action" : "send"
}

/** Returns true only if the action was actually performed. When the host did
 *  not wire a handler for this command, returns false so the caller falls back
 *  to sending it as text (rather than silently doing nothing). */
export function runUiAction(name: string, ctx: SlashUiActionContext): boolean {
  if (name === "config") {
    if (ctx.openSettings) { ctx.openSettings(); return true }
    return false
  }
  return false
}
