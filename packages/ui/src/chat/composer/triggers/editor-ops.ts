import { InputDraftProjection } from "./input-draft";
/**
 * The four scoped `slash/input-*` verbs, implemented against Amiba's Lexical
 * editor.
 *
 * These are the ONE place a `PickOutcome` becomes an edit — the in-session
 * path reaches them through the host's bail listeners, the session-less
 * home/Quick-Ask path reaches them through {@link applyPickOutcome} directly.
 * That is what keeps the two mount paths from diverging.
 *
 * APPLIED TRUTH. Every verb runs its transaction inside `editor.update(…, {
 * discrete: true })` and decides its answer from what the transaction
 * OBSERVABLY left behind — a re-scan of the draft, or a post-condition on it
 * — never from "we called update, so it must have worked". A listener that
 * always returns `true` is a silent lie to every plugin author, so:
 *
 *   - a stale `draftRev` (span CAS miss) answers false without touching the
 *     tree;
 *   - a splice whose result is byte-identical answers false;
 *   - a nested `editor.update` (whose closure Lexical would DEFER) answers
 *     false, because `ran` stays unset. Every call site is deliberately
 *     outside a Lexical update for exactly this reason.
 */

import {
  $createParagraphNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import { $createMentionNode } from "../MentionNode";
import type { MentionData } from "../providers/types";
import { CommandClaimStore } from "./claim";
import type {
  CommandClaim,
  ConsumeTokenGuard,
  PickOutcome,
  ReferenceInsert,
  TokenSpan,
  TriggerEditorOps,
} from "./contracts";
import { $scanDraft, $spliceTriggerRange, $spliceTriggerText } from "./lexical-draft";

/** The mention type minted from an official `{ insert }` outcome. */
export const REFERENCE_MENTION_TYPE = "dsh.reference";

/** Payload field order of a `dsh.reference` mention (see `serialize.ts`). */
export const REFERENCE_MENTION_FIELDS = [
  "source",
  "ref",
  "label",
  "clipboardText",
] as const;

/** Project one official `ReferenceInsert` onto Amiba's chip payload. */
export function referenceMention(reference: ReferenceInsert): MentionData {
  return {
    type: REFERENCE_MENTION_TYPE,
    payload: {
      source: reference.source,
      ref: reference.ref,
      label: reference.label,
      clipboardText: reference.clipboardText,
    },
    display: reference.label,
  };
}

/** Monotonic draft revision; the currency of every span CAS. */
export class DraftRevision {
  private current = 0;

  get value(): number {
    return this.current;
  }

  bump(): number {
    this.current += 1;
    return this.current;
  }
}

/**
 * Run one transaction and report whether it observably applied.
 *
 * `ran` guards the nested-update case: Lexical defers a nested `update`
 * closure to the end of the outer transaction, so it would not have executed
 * by the time this returns. Answering false there is the honest reading.
 */
function transact(
  editor: LexicalEditor,
  body: () => boolean,
): boolean {
  let ran = false;
  let applied = false;
  editor.update(
    () => {
      ran = true;
      applied = body();
    },
    { discrete: true },
  );
  return ran && applied;
}

export function createTriggerEditorOps(
  editor: LexicalEditor,
  claims: CommandClaimStore,
  revision: DraftRevision,
): TriggerEditorOps {
  /** Span CAS: revision equality plus bounds sanity (upstream `casOk`). */
  const casOk = (span: TokenSpan, draftLength: number): boolean =>
    span.draftRev === revision.value &&
    span.start >= 0 &&
    span.start <= span.end &&
    span.end <= draftLength;

  const inputDraft = new InputDraftProjection();
  return {
    readInputDraft() {
      return editor.getEditorState().read(() => inputDraft.read());
    },
    subscribeInputDraft(listener) {
      return editor.registerUpdateListener(({ editorState }) => {
        // Advance public revisions even when no subscriber reads this update;
        // editing away and back must still invalidate an earlier span.
        editorState.read(() => inputDraft.read());
        listener();
      });
    },
    beginCommand(claim: CommandClaim, span: TokenSpan): boolean {
      const entered = transact(editor, () => {
        const before = $scanDraft();
        if (!casOk(span, before.draft.length)) return false;
        // Upstream's leading-position guard: a claim may only take the head
        // of the draft.
        if (before.draft.slice(0, span.start).trim() !== "") return false;
        // Upstream: `adopt(claim.token + draft.slice(span.end))`.
        $spliceTriggerText(0, span.end, claim.token);
        // POST-CONDITION, observed: command mode means the draft now opens
        // with the claim token. A no-op splice (the draft already read
        // exactly that) is still a true "applied" — the input IS claimed —
        // while a rejected transaction leaves the draft unchanged and fails
        // this check.
        return $scanDraft().draft.startsWith(claim.token);
      });
      if (entered) claims.begin(claim);
      return entered;
    },

    insertReference(reference: ReferenceInsert, span: TokenSpan): boolean {
      return transact(editor, () => {
        const before = $scanDraft();
        if (!casOk(span, before.draft.length)) return false;
        // Upstream mints `PLACEHOLDER + (a separating space unless one
        // already follows)`; Amiba's chip IS the placeholder, so only the
        // gap needs deciding.
        const tail = before.draft.slice(span.end);
        const gap = tail.length === 0 || tail[0] !== " " ? " " : "";
        const applied = $spliceTriggerRange(span.start, span.end, [
          $createMentionNode(referenceMention(reference)),
        ]);
        if (!applied) return false;
        if (gap !== "") {
          const after = $scanDraft();
          const caret = span.start + 1;
          if (caret <= after.draft.length) $spliceTriggerText(caret, caret, gap);
        }
        return true;
      });
    },

    consumeToken(guard: ConsumeTokenGuard): boolean {
      return transact(editor, () => {
        const before = $scanDraft();
        if (guard.kind === "span") {
          if (!casOk(guard.span, before.draft.length)) return false;
          if (guard.span.start === guard.span.end) return false;
          return $spliceTriggerRange(guard.span.start, guard.span.end, []);
        }
        if (guard.token === "" || before.draft.trim() !== guard.token) {
          return false;
        }
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
        return $scanDraft().draft === "" && before.draft !== "";
      });
    },

    insertText(text: string, span: TokenSpan): boolean {
      return transact(editor, () => {
        const before = $scanDraft();
        if (!casOk(span, before.draft.length)) return false;
        return $spliceTriggerText(span.start, span.end, text);
      });
    },
  };
}

/**
 * Apply one `PickOutcome` through the four verbs — the SAME routing the
 * official controller's private `execute` performs
 * (`dsh-client-ui-input-trigger/lib/client.js` lines 484-499):
 *
 *   `{ claim }`  → begin-command
 *   `{ text }`   → insert-text
 *   `{ insert }` → insert-reference
 *   `'handled'` / `undefined` → nothing dispatched, answer false
 *
 * The in-session path never calls this (the controller dispatches the bail
 * events itself); the session-less path does, so a home-composer pick and an
 * in-session pick land on identical code.
 */
export function applyPickOutcome(
  ops: TriggerEditorOps,
  outcome: PickOutcome,
  span: TokenSpan,
): boolean {
  if (outcome === undefined || outcome === "handled") return false;
  if ("claim" in outcome) return ops.beginCommand(outcome.claim, span);
  if ("text" in outcome) return ops.insertText(outcome.text, span);
  return ops.insertReference(outcome.insert, span);
}
