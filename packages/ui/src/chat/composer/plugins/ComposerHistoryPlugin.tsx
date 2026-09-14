import { HistoryPlugin, createEmptyHistoryState, type HistoryState } from "@lexical/react/LexicalHistoryPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";
import { useLayoutEffect, useMemo } from "react";
import type { ComposerDraftSource } from "../../composer-draft-store";
import { composerDraftDocument, type ComposerDraftDocument } from "../../composer-draft-document";
import { $readComposerParts } from "../composer-parts";

import { composerHistories as histories, trackComposerHistory } from "../composer-history-state";
const restored = new WeakMap<LexicalEditor, ComposerDraftDocument>();

/** Avoid rebuilding the exact node tree restored together with its history. */
export function consumeRestoredDocument(editor: LexicalEditor, document: ComposerDraftDocument): boolean {
  const saved = restored.get(editor);
  restored.delete(editor);
  return saved === document;
}

export function ComposerHistoryPlugin({ source }: { source?: ComposerDraftSource }) {
  const [editor] = useLexicalComposerContext();
  const { history, saved } = useMemo(() => {
    const candidate = source && histories.get(source);
    const saved = candidate?.document === source?.getDocument() && candidate?.version === (source?.getHistoryVersion?.() ?? 0) ? candidate : undefined;
    const history: HistoryState = saved ? {
      current: saved.current ? { editor, editorState: saved.current } : null,
      undoStack: saved.undo.map(editorState => ({ editor, editorState })),
      redoStack: saved.redo.map(editorState => ({ editor, editorState })),
    } : createEmptyHistoryState();
    return { history, saved };
  }, [editor, source]);
  useLayoutEffect(() => {
    let active = true;
    const untrack = source && trackComposerHistory(source, { editor, history });
    let version = source?.getHistoryVersion?.() ?? 0;
    const clear = () => {
      history.current = null;
      history.undoStack = [];
      history.redoStack = [];
    };
    const off = source?.subscribe(() => {
      const next = source.getHistoryVersion?.() ?? 0;
      if (version !== next) {
        version = next;
        clear();
        const state = editor.getEditorState();
        // An image-only send may consume an already empty document, so no
        // editor update follows. Seed that empty state for the next edit's undo.
        if (state.read(() => JSON.stringify(composerDraftDocument($readComposerParts()))) === JSON.stringify(source.getDocument())) {
          history.current = { editor, editorState: state };
        }
      }
    });
    if (saved) {
      restored.set(editor, saved.document);
      // Reconcile decorators outside React's layout phase (Lexical may flushSync).
      queueMicrotask(() => {
        if (!active) return;
        // A resident write can land after render/layout but before this task.
        // Revalidate at the actual commit boundary, not only in useMemo.
        if (source?.getDocument() !== saved.document || (source?.getHistoryVersion?.() ?? 0) !== saved.version) {
          restored.delete(editor);
          clear();
          return;
        }
        editor.setEditorState(saved.state, { tag: "historic" });
      });
    }
    return () => {
      active = false;
      untrack?.();
      off?.();
      restored.delete(editor);
      if (!source) return;
      const document = source.getDocument();
      const state = editor.getEditorState();
      // An external/offscreen write is not represented by this editor's history.
      // Do not let a stale tree overwrite that newer document on the next mount.
      const same = state.read(() => JSON.stringify(composerDraftDocument($readComposerParts()))) === JSON.stringify(document);
      const entries = [...history.undoStack, ...history.redoStack, ...(history.current ? [history.current] : [])];
      if (!same || entries.some(entry => entry.editor !== editor)) { histories.delete(source); return; }
      histories.set(source, { version: source.getHistoryVersion?.() ?? 0, document, state, current: history.current?.editorState ?? null,
        undo: history.undoStack.map(entry => entry.editorState), redo: history.redoStack.map(entry => entry.editorState) });
    };
  }, [editor, source, history, saved]);
  return <HistoryPlugin externalHistoryState={history} />;
}
