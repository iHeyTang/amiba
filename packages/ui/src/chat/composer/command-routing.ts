import { runUiAction, slashKindFor, type SlashUiActionContext } from "./providers/slash-ui-actions"
import { argsAfter } from "./triggers/claim"
import type { CommandClaim } from "./triggers/contracts"

/**
 * The claim arm of the submit router. When command mode is active, Enter is
 * the claim's own transaction — never an ordinary send — and the args are
 * whatever follows the integrity-watched token.
 */
export interface CommandClaimRoute {
  /** The active claim, or null when the input is plain. */
  current: CommandClaim | null
  /** Run the claim's submit transaction with the parsed args. */
  run(claim: CommandClaim, args: string): void
}

/** Returns true if the submit was fully handled (UI action performed, or a
 *  command claim took it). False means the caller should proceed with normal
 *  send (text command or plain message). */
export function routeSubmit(
  value: string,
  opts: {
    send: (text: string) => void
    ctx: SlashUiActionContext
    claim?: CommandClaimRoute
  },
): boolean {
  // COMMAND MODE FIRST. A claimed input is not a `/`-prefixed message any
  // more: upstream's `onEnter` checks the claimed phase before it looks at
  // the draft at all, and so does this.
  const claim = opts.claim?.current
  if (claim && value.startsWith(claim.token)) {
    opts.claim?.run(claim, argsAfter(value, claim.token))
    return true
  }
  const trimmed = value.trim()
  if (!trimmed.startsWith("/")) return false
  const name = trimmed.slice(1).split(/\s+/)[0]
  if (slashKindFor(name) === "ui-action") {
    return runUiAction(name, opts.ctx)
  }
  return false
}
