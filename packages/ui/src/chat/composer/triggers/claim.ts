/**
 * Command-mode state: the client half of the official `CommandClaim`
 * lifecycle.
 *
 * A claim is a draft prefix (`'/goal '`) plus a submit closure. Once entered,
 * the input is "claimed": `'/'` stops opening the trigger menu
 * (`TriggerGuard.tier === 'claimed'`) and Enter routes through
 * `claim.submit(args, actx)` instead of the ordinary send. Any edit that
 * breaks `draft.startsWith(token)` releases the claim — that is the token
 * INTEGRITY WATCH, and it is the reason this store is fed every draft change.
 *
 * Mirrors `InputMachine.watchClaim` / `argsAfter` in
 * `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` (lines 498-504 and
 * 366-375 of the built client bundle).
 */

import type { CommandClaim } from "./contracts";

/**
 * Strip the claim token off a draft to yield submit args. Leading whitespace
 * is tolerated; a bare `/name` missing the token's trailing separator yields
 * empty args; exactly one separator char is consumed and the remainder —
 * newlines included — stays verbatim.
 *
 * Byte-for-byte the upstream rule (`argsAfter`).
 */
export function argsAfter(draft: string, token: string): string {
  const s = draft.trimStart();
  if (s.startsWith(token)) return s.slice(token.length);
  const base = token.trimEnd();
  if (s.startsWith(base)) {
    const rest = s.slice(base.length);
    return /^\s/u.test(rest) ? rest.slice(1) : rest;
  }
  return "";
}

/** Observable holder of the active claim (null = plain input). */
export class CommandClaimStore {
  private current: CommandClaim | null = null;
  private readonly listeners = new Set<() => void>();

  get(): CommandClaim | null {
    return this.current;
  }

  /** Enter command mode. */
  begin(claim: CommandClaim): void {
    if (this.current === claim) return;
    this.current = claim;
    this.emit();
  }

  /**
   * Integrity watch. Called with every draft the editor publishes; a draft
   * that no longer starts with the claim token releases the claim.
   */
  watch(draft: string): void {
    if (this.current === null) return;
    if (draft.startsWith(this.current.token)) return;
    this.release();
  }

  release(): void {
    if (this.current === null) return;
    this.current = null;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
