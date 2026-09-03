import type {
  SessionBadgeContribution,
  SessionBadgeTarget,
  SessionFilterContribution,
} from "@amiba/dsh-plugin-ui-shell/client";

/** Tiny client-side cache: the steward session id and which sessions are already managed. */
export interface StewardClientState {
  stewardSessionId(): string | null;
  setStewardSessionId(id: string): void;
  adoptedSessionIds(): ReadonlySet<string>;
  setAdopted(ids: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
}

export function createStewardClientState(): StewardClientState {
  let stewardId: string | null = null;
  let adopted: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    stewardSessionId: () => stewardId,
    setStewardSessionId(id) {
      stewardId = id;
      notify();
    },
    adoptedSessionIds: () => adopted,
    setAdopted(ids) {
      adopted = new Set(ids);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The `amiba.sessions.item.badge` business face: a session carries the
 * 「大管家」 badge exactly when it's in the live adopted set. `resolve` reads
 * `state.adoptedSessionIds()` at CALL time (not at registration time), so a
 * later `state.setAdopted(...)` — from the periodic refresh, an adopt, or
 * the initial apply-time fetch in `index.tsx` — is reflected the next time
 * the host calls `resolve` for that session, with no extra plumbing needed.
 */
export function stewardBadgeFace(state: StewardClientState): SessionBadgeContribution {
  return {
    resolve: (session: SessionBadgeTarget) => state.adoptedSessionIds().has(session.id),
    // `state.subscribe` already notifies on every `setAdopted(...)` — the
    // periodic refresh, an adopt, and the initial apply-time fetch all
    // route through it — so it's also exactly the right signal for the
    // shell: fire it and the session list re-renders this badge instead of
    // waiting for some unrelated render to pick up the fresh value.
    subscribe: state.subscribe,
  };
}

/** The `amiba.sessions.list.filter` business face — same live read, keyed as a boolean test. */
export function stewardFilterFace(state: StewardClientState): SessionFilterContribution {
  return {
    test: (session: SessionBadgeTarget) => state.adoptedSessionIds().has(session.id),
    subscribe: state.subscribe,
  };
}
