/**
 * Adapter: one official `InputTriggerSource` seen as a surface-local
 * `TriggerProvider`.
 *
 * This is the ONLY thing that lets a source reach a surface with no plugin
 * runtime (Quick-Ask, the browser extension) and the session-less home
 * composer. It is deliberately THIN — it neither re-implements candidate
 * fetching nor re-decides what a pick means:
 *
 *   - `search` forwards straight to `source.candidates`;
 *   - `onSelect` calls `source.onPick` and hands the returned `PickOutcome`
 *     to {@link applyPickOutcome}, the same four editor verbs the in-session
 *     bail listeners drive.
 *
 * So the semantic gap the migration had to close — Amiba's old
 * `onSelect(item, editor)` mutated Lexical imperatively, while official
 * `onPick` returns a declarative outcome the pipeline applies — is closed
 * once, here, for both mounts.
 */

import type { LexicalEditor } from "lexical";
import type { CommandClaimStore } from "../triggers/claim";
import { localSessionContext } from "../triggers/contracts";
import type {
  InputTriggerCandidate,
  InputTriggerSource,
} from "../triggers/contracts";
import {
  applyPickOutcome,
  createTriggerEditorOps,
  type DraftRevision,
} from "../triggers/editor-ops";
import type { MenuItem, TriggerHitContext, TriggerProvider } from "./types";

/** Menu item → the candidate and source it came from (pick routing). */
const origins = new WeakMap<
  MenuItem,
  { source: InputTriggerSource; candidate: InputTriggerCandidate }
>();

export interface SourceAdapterDeps {
  /** Session the source is asked about; blank on a not-yet-materialized draft. */
  sessionId?: string;
  /** Shared command-mode store — a `{ claim }` outcome writes here. */
  claims: CommandClaimStore;
  /** Shared draft revision — the currency every span CAS is checked against. */
  revision: DraftRevision;
  /** Display label for the source's menu group. */
  label?: string;
}

export function sourceToProvider(
  source: InputTriggerSource,
  deps: SourceAdapterDeps,
): TriggerProvider {
  return {
    trigger: source.trigger,
    id: source.name,
    group: deps.label ?? source.name,
    match: () => true,
    async search(query: string, hit?: TriggerHitContext): Promise<MenuItem[]> {
      const controller = new AbortController();
      const candidates = await source.candidates(
        localSessionContext(deps.sessionId ?? ""),
        {
          query,
          position: hit?.position ?? "leading",
          signal: controller.signal,
        },
      );
      return candidates.map((candidate, index) => {
        const item: MenuItem = {
          id: `${source.name}:${index}:${candidate.name}`,
          label: candidate.name,
          ...(candidate.description !== undefined
            ? { description: candidate.description }
            : {}),
        };
        origins.set(item, { source, candidate });
        return item;
      });
    },
    onSelect(item: MenuItem, editor: LexicalEditor, hit?: TriggerHitContext) {
      const origin = origins.get(item);
      if (origin === undefined || hit === undefined) return;
      const outcome = origin.source.onPick({
        candidate: origin.candidate,
        session: localSessionContext(deps.sessionId ?? ""),
        position: hit.position,
        via: "menu",
        span: hit.span,
      });
      applyPickOutcome(
        createTriggerEditorOps(editor, deps.claims, deps.revision),
        outcome,
        hit.span,
      );
    },
  };
}
