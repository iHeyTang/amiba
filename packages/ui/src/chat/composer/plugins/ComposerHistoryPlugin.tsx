import { HistoryPlugin, createEmptyHistoryState, type HistoryState } from "@lexical/react/LexicalHistoryPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { EditorState, LexicalEditor } from "lexical";
import { useLayoutEffect, useMemo } from "react";
import type { ComposerDraftSource } from "../../composer-draft-store";
import { composerDraftDocument, type ComposerDraftDocument } from "../../composer-draft-document";
import { $readComposerParts } from "../composer-parts";

type SavedHistory = {
  document: ComposerDraftDocument;
  state: EditorState;
  current: EditorState | null;
  undo: EditorState[];
  redo: EditorState[];
};
const histories = new WeakMap<ComposerDraftSource, SavedHistory>();
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
    const saved = candidate?.document === source?.getDocument() ? candidate : undefined;
    const history: HistoryState = saved ? {
      current: saved.current ? { editor, editorState: saved.current } : null,
      undoStack: saved.undo.map(editorState => ({ editor, editorState })),
      redoStack: saved.redo.map(editorState => ({ editor, editorState })),
    } : createEmptyHistoryState();
    return { history, saved };
  }, [editor, source]);
  useLayoutEffect(() => {
    let active = true;
    if (saved) {
      restored.set(editor, saved.document);
      // Reconcile decorators outside React's layout phase (Lexical may flushSync).
      queueMicrotask(() => { if (active) editor.setEditorState(saved.state, { tag: "historic" }); });
    }
    return () => {
      active = false;
      restored.delete(editor);
      if (!source) return;
      const document = source.getDocument();
      const state = editor.getEditorState();
      // An external/offscreen write is not represented by this editor's history.
      // Do not let a stale tree overwrite that newer document on the next mount.
      const same = state.read(() => JSON.stringify(composerDraftDocument($readComposerParts()))) === JSON.stringify(document);
      const entries = [...history.undoStack, ...history.redoStack, ...(history.current ? [history.current] : [])];
      if (!same || entries.some(entry => entry.editor !== editor)) { histories.delete(source); return; }
      histories.set(source, { document, state, current: history.current?.editorState ?? null,
        undo: history.undoStack.map(entry => entry.editorState), redo: history.redoStack.map(entry => entry.editorState) });
    };
  }, [editor, source, history, saved]);
  return <HistoryPlugin externalHistoryState={history} />;
}
