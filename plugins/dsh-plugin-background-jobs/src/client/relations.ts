import type { JobRelation } from "../remote.js";
/** Connection-local presentation metadata, never a second job status store. */
export function createRelations() {
  const entries = new Map<string, readonly JobRelation[]>();
  const errors = new Map<string, string>();
  const opens = new Map<string, { version: number; id: string }>();
  const listeners = new Set<() => void>();
  const empty: readonly JobRelation[] = [];
  return {
    error: (sessionId: string) => errors.get(sessionId) ?? "",
    setError: (sessionId: string, error: string) => { errors.set(sessionId, error); for (const notify of listeners) notify(); },
    openVersion: (sessionId: string) => opens.get(sessionId)?.version ?? 0,
    requestedJob: (sessionId: string) => opens.get(sessionId)?.id,
    open: (sessionId: string, id: string) => { opens.set(sessionId, { version: (opens.get(sessionId)?.version ?? 0) + 1, id }); for (const notify of listeners) notify(); },
    get: (sessionId: string) => entries.get(sessionId) ?? empty,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (sessionId: string, rows: readonly JobRelation[]) => { entries.set(sessionId, rows); for (const notify of listeners) notify(); },
    clear: () => { entries.clear(); opens.clear(); errors.clear(); for (const notify of listeners) notify(); },
  };
}
export type Relations = ReturnType<typeof createRelations>;
