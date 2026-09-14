import type { HistoryState } from "@lexical/react/LexicalHistoryPlugin";
import type { EditorState, LexicalEditor } from "lexical";
import type { ComposerDraftSource } from "../composer-draft-store";
import { composerDraftDocument, type ComposerDraftDocument } from "../composer-draft-document";
import { $readComposerParts } from "./composer-parts";

export type SavedComposerHistory = {
  version: number;
  document: ComposerDraftDocument;
  state: EditorState;
  current: EditorState | null;
  undo: EditorState[];
  redo: EditorState[];
};
export const composerHistories = new WeakMap<ComposerDraftSource, SavedComposerHistory>();
type ActiveHistory = { editor: LexicalEditor; history: HistoryState };
const activeHistories = new WeakMap<ComposerDraftSource, Set<ActiveHistory>>();

export function trackComposerHistory(source: ComposerDraftSource, active: ActiveHistory): () => void {
  let entries = activeHistories.get(source);
  if (!entries) { entries = new Set(); activeHistories.set(source, entries); }
  entries.add(active);
  return () => { entries.delete(active); if (!entries.size) activeHistories.delete(source); };
}

/** Capture before clearing for submission; confirm later without erasing newer edits. */
export function captureComposerHistory(source: ComposerDraftSource): () => void {
  const past = new Set<EditorState>();
  const saved = composerHistories.get(source);
  if (saved) {
    for (const state of [saved.state, saved.current, ...saved.undo, ...saved.redo]) if (state) past.add(state);
  }
  for (const { editor, history } of activeHistories.get(source) ?? []) {
    past.add(editor.getEditorState());
    for (const entry of [history.current, ...history.undoStack, ...history.redoStack]) if (entry) past.add(entry.editorState);
  }
  let confirmed = false;
  return () => {
    if (confirmed) return;
    confirmed = true;
    for (const { editor, history } of activeHistories.get(source) ?? []) {
      history.undoStack = history.undoStack.filter(entry => !past.has(entry.editorState));
      history.redoStack = history.redoStack.filter(entry => !past.has(entry.editorState));
      if (history.current && past.has(history.current.editorState)) {
        const state = editor.getEditorState();
        // Seed an already-empty image-only draft, but never seed a tree whose
        // clear is still waiting to commit. Newer visible drafts stay untouched.
        const matches = state.read(() => JSON.stringify(composerDraftDocument($readComposerParts()))) === JSON.stringify(source.getDocument());
        history.current = matches ? { editor, editorState: state } : null;
      }
    }
    const cached = composerHistories.get(source);
    if (cached) {
      cached.undo = cached.undo.filter(state => !past.has(state));
      cached.redo = cached.redo.filter(state => !past.has(state));
      if (cached.current && past.has(cached.current)) cached.current = cached.state;
    }
    past.clear();
  };
}
