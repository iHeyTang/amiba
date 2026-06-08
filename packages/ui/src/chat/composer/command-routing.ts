import { runUiAction, slashKindFor, type SlashUiActionContext } from "./providers/slash-ui-actions"

/** Returns true if the submit was fully handled (UI action performed). False
 *  means the caller should proceed with normal send (text command or plain message). */
export function routeSubmit(
  value: string,
  opts: { send: (text: string) => void; ctx: SlashUiActionContext },
): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) return false
  const name = trimmed.slice(1).split(/\s+/)[0]
  if (slashKindFor(name) === "ui-action") {
    return runUiAction(name, opts.ctx)
  }
  return false
}
