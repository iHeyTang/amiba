import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";
import type { ComposerDraftDocument } from "./composer-draft-document";
import { createComposerDraftSource, sessionComposerDraft } from "./composer-draft-store";

/** The setter stays addressed to its session, including across async completions. */
export function useSessionComposerDraft(sessionId: string | null | undefined) {
  const storage = getPlatform().storage;
  const home = useMemo(() => createComposerDraftSource(), []);
  const source = useMemo(() => sessionId ? sessionComposerDraft(storage, sessionId) : home, [storage, sessionId, home]);
  const value = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const setForSession = useCallback((id: string, text: string, document?: ComposerDraftDocument) => {
    const target = sessionComposerDraft(storage, id);
    if (document) target.setParts(document.parts);
    else target.set(text);
  }, [storage]);
  return [value, source.set, setForSession, source] as const;
}
