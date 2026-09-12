import { $getRoot } from "lexical";
/**
 * THE DRIVER. Everything upstream's ui-conversation InputBar supplies to the
 * official trigger pipeline, supplied here from Amiba's Lexical composer.
 *
 * Without this, `ctx.inputTriggers.registerSource(...)` would succeed and
 * then never be consulted — a silent lie to every plugin author. With it,
 * a registered source's `warm`, `candidates`, `onPick`, `matchSpace`,
 * `matchEnter` and `codec` are all actually reached.
 *
 * Call sites, and why each is where it is:
 *
 *   - `track(draft, caret, guard, draftRev)` — on every editor update, from
 *     `registerUpdateListener`. Read-only, so it is safe inside Lexical's
 *     update lifecycle.
 *   - `onSpace()` — from a NATIVE keydown listener on the editor root, NOT a
 *     Lexical command. A Lexical command handler runs INSIDE `editor.update`,
 *     and a nested `editor.update` is DEFERRED, so the four editor verbs
 *     could not report applied-truth from there. Upstream reaches the same
 *     conclusion by a different road: it listens on the textarea.
 *   - `bindEditor(...)` — mounts the four scoped `slash/input-*` bail
 *     listeners for this session, delegating to the Lexical verbs. The
 *     listeners exist EXACTLY while this plugin is mounted, so "no editor"
 *     is reported as "not applied" by the absence of a listener rather than
 *     by a listener that lies.
 *   - `adjudicate(...)` — the Enter path, driven from `Composer.handleSend`
 *     (it owns submit).
 *   - `pick` / `dismiss` — driven by the menu, from the shadowed overlay
 *     seat.
 */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect } from "react";
import { $caretOffset, $scanDraft } from "../triggers/lexical-draft";
import { createTriggerEditorOps } from "../triggers/editor-ops";
import type { ComposerTriggerSession } from "../triggers/session";

export function OfficialTriggerPlugin({
  trigger,
}: {
  trigger: ComposerTriggerSession;
}) {
  const [editor] = useLexicalComposerContext();
  const { controller, runtime, sessionId, claims, revision } = trigger;

  // The four scoped bail listeners, for as long as this editor is mounted.
  useEffect(() => {
    if (runtime === undefined || !sessionId) return;
    let active = true;
    let off: (() => void) | undefined;
    // MentionSerializePlugin commits external/session draft changes in the
    // preceding microtask. Do not publish the outgoing node tree under the
    // incoming session, or force a synchronous Lexical flush during React effects.
    queueMicrotask(() => {
      if (!active) return;
      off = runtime.bindEditor(
        sessionId,
        createTriggerEditorOps(editor, claims, revision, () => editor.isEditable() && trigger.guard().tier !== "frozen"),
      );
    });
    return () => { active = false; off?.(); };
  }, [claims, editor, revision, runtime, sessionId]);

  // `commandUi` returns focus to the composer after a popup settles.
  useEffect(() => {
    if (runtime?.bindComposerFocus === undefined || !sessionId) return;
    return runtime.bindComposerFocus(sessionId, () => editor.focus());
  }, [editor, runtime, sessionId]);

  useEffect(() => {
    if (controller === undefined) return;
    let lastDraft: string | null = null;
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const scan = $scanDraft();
        const caret = $caretOffset(scan);
        // Identity/label changes can leave the one-character trigger draft
        // unchanged, but still invalidate a public input/reference snapshot.
        const persistedDraft = $getRoot().getTextContent();
        if (persistedDraft !== lastDraft) {
          lastDraft = persistedDraft;
          revision.bump();
          // Token integrity watch: an edit that breaks the claim prefix
          // releases command mode (upstream `watchClaim`).
          claims.watch(scan.draft);
        }
        controller.track(
          scan.draft,
          caret ?? scan.draft.length,
          trigger.guard(),
          revision.value,
        );
      });
    });
  }, [claims, controller, editor, revision, trigger]);

  // Space adjudication. Native listener on the content-editable root so the
  // handler runs OUTSIDE any Lexical update (see the header note).
  useEffect(() => {
    if (controller === undefined) return;
    let attached: HTMLElement | null = null;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== " " || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (controller.onSpace()) event.preventDefault();
    };
    const dispose = editor.registerRootListener((root, previous) => {
      if (previous !== null) previous.removeEventListener("keydown", onKeyDown);
      if (root !== null) root.addEventListener("keydown", onKeyDown);
      attached = root;
    });
    return () => {
      attached?.removeEventListener("keydown", onKeyDown);
      dispose();
    };
  }, [controller, editor]);

  return null;
}
