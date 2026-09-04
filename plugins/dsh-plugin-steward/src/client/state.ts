import type {
  SessionGroupContribution,
  SessionListItemTarget,
  SessionMenuContribution,
} from "@amiba/dsh-plugin-ui-shell/client";

import type { AdoptResult } from "../types.js";

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
 * The `amiba.sessions.list.group` business face: a session is claimed by the
 * 「大管家」group exactly when it's in the live adopted set. `claim` reads
 * `state.adoptedSessionIds()` at CALL time (not at registration time), so a
 * later `state.setAdopted(...)` — from the periodic refresh, an adopt, or
 * the initial apply-time fetch in `index.tsx` — is reflected the next time
 * the host calls `claim` for that session, with no extra plumbing needed.
 */
export function stewardGroupFace(state: StewardClientState): SessionGroupContribution {
  return {
    claim: (session: SessionListItemTarget) => state.adoptedSessionIds().has(session.id),
    // `state.subscribe` already notifies on every `setAdopted(...)` — the
    // periodic refresh, an adopt, and the initial apply-time fetch all
    // route through it — so it's also exactly the right signal for the
    // shell: fire it and the session list re-renders this group membership
    // instead of waiting for some unrelated render to pick up the fresh
    // value.
    subscribe: state.subscribe,
  };
}

/** The host calls needed by `stewardMenuFace`'s `run` — kept as an explicit
 *  dependency object (rather than closing over `index.tsx`'s locals) so the
 *  face is unit-testable without the plugin's `apply()` wiring. */
export interface StewardMenuDeps {
  adopt(sessionId: string): Promise<AdoptResult>;
  refreshAdopted(): Promise<void>;
}

/**
 * The `amiba.sessions.item.menu` business face: adds a "交给大管家" item to
 * every session row's ⋯ menu, except the steward's own session and sessions
 * already adopted. `run` mirrors what the old header `AdoptAction` did on
 * click — adopt, then (only on an actual `"adopted"` result) add the id to
 * the local set and refetch from the host so the set stays correct even if
 * adopt routed to a different/existing session than the one clicked. A
 * `"candidates"` result can't happen for an id-based adopt (see
 * `AdoptResult`) but is handled as a no-op to keep this total. Errors from
 * `deps.adopt` propagate — the session list catches and logs them, same as
 * every other menu contribution's `run`.
 */
export function stewardMenuFace(state: StewardClientState, deps: StewardMenuDeps): SessionMenuContribution {
  return {
    visible: (session: SessionListItemTarget) =>
      session.id !== state.stewardSessionId() && !state.adoptedSessionIds().has(session.id),
    run: async (session: SessionListItemTarget) => {
      const result = await deps.adopt(session.id);
      if (result.kind === "adopted") {
        state.setAdopted([...state.adoptedSessionIds(), result.task.sessionId]);
        await deps.refreshAdopted();
      }
    },
    subscribe: state.subscribe,
  };
}
