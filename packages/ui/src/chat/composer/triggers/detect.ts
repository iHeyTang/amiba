/**
 * FAITHFUL MIRROR of the official trigger detector.
 *
 * `@deepseek-ai/dsh-client-ui-input-trigger` keeps `detectTrigger` internal:
 * its `package.json` `files` list ships only `lib/{index,invariant,client}.js`
 * plus declarations, and neither the root nor the `/client` entry re-exports
 * the core. The in-session path never needs it — the official
 * `InputTriggerController.track` runs the real one — but the SESSION-LESS
 * path (home/draft composer, Quick-Ask, the browser extension) has no
 * controller and must detect for itself.
 *
 * So this is a byte-faithful port of the built source
 * (`dsh-client-ui-input-trigger/lib/client.js`, `boundaryOk` at lines 22-32
 * and `detectTrigger` at lines 49-69), the same mirror-with-a-citation
 * pattern Phase 1 used for `shell.overlay`. Keep the two in step: if the
 * upstream algorithm changes, the session-less menu would silently disagree
 * with the in-session one.
 */

import type { TriggerGuard, TriggerPosition, TriggerChar } from "./contracts";

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const WHITESPACE = /\s/u;

/** A detected trigger token under the caret, in trigger-draft coordinates. */
export interface TriggerHit {
  readonly trigger: TriggerChar;
  readonly query: string;
  readonly position: TriggerPosition;
  readonly span: { readonly start: number; readonly end: number; readonly draftRev: number };
}

/**
 * Word-boundary rule: a trigger char opens only at start-of-draft, after
 * whitespace (newlines included), or after punctuation. Two URL carve-outs
 * keep '/' dead inside URLs: '/' after a ':' that itself follows a
 * non-whitespace char (`https:/…`), and '/' directly after another '/'.
 */
function boundaryOk(draft: string, index: number, char: string): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  if (char === "/") {
    if (prev === "/") return false;
    if (prev === ":" && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) {
      return false;
    }
  }
  return true;
}

/**
 * Detect a trigger token at the caret. Scans left and stops at the first
 * whitespace; trigger chars failing the guard tier or the word boundary are
 * treated as ordinary token chars and the scan continues.
 */
export function detectTrigger(
  draft: string,
  caret: number,
  guard: TriggerGuard,
  draftRev = 0,
): TriggerHit | null {
  if (guard.tier === "frozen") return null;
  for (let i = caret - 1; i >= 0; i -= 1) {
    const ch = draft.charAt(i);
    if (WHITESPACE.test(ch)) return null;
    if (ch !== "/" && ch !== "@") continue;
    if (guard.tier === "claimed" && ch === "/") continue;
    if (!boundaryOk(draft, i, ch)) continue;
    return {
      trigger: ch,
      query: draft.slice(i + 1, caret),
      position: draft.search(/\S/u) === i ? "leading" : "inline",
      span: { start: i, end: caret, draftRev },
    };
  }
  return null;
}
