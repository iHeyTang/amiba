/**
 * React bindings for ``SessionsStore``.
 *
 * The store is a vanilla class — to integrate it with React's
 * concurrent rendering safely we go through ``useSyncExternalStore``,
 * the official subscription primitive added in React 18.
 *
 * Single-instance contract: ``<SessionsProvider>`` MUST wrap every
 * subtree that calls ``useSessions()``. The provider owns the store,
 * runs its lifecycle (``initialize`` on mount, ``teardown`` on
 * unmount), and broadcasts the store via Context. Consumers receive
 * the SAME controller reference regardless of where they sit in the
 * tree — eliminating the cross-instance broadcast races that the old
 * hook-per-consumer architecture suffered from.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

import { SessionsStore } from "./sessions-store";
import type { SessionsController, SessionsState } from "./types";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SessionsStoreContext = createContext<SessionsStore | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface SessionsProviderProps {
  children: ReactNode;
  /**
   * Optional injected store — primarily for tests that want to seed
   * fixtures. Production code should always let the provider mint its
   * own.
   */
  store?: SessionsStore;
}

/**
 * Mount one ``SessionsStore`` per subtree and expose it to descendants
 * via context. Place at the root of every entry point that renders a
 * component using ``useSessions()`` (desktop App, extension sidepanel,
 * extension chat tab, extension newtab).
 */
export function SessionsProvider({
  children,
  store: injected,
}: SessionsProviderProps): ReactElement {
  const [store] = useState<SessionsStore>(
    () => injected ?? new SessionsStore(),
  );

  useEffect(() => {
    void store.initialize();
    return () => {
      store.teardown();
    };
  }, [store]);

  return (
    <SessionsStoreContext.Provider value={store}>
      {children}
    </SessionsStoreContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Resolve the open-tab ids against the session index. Defensive filter
 * drops dangling refs (a tab id without a backing session — shouldn't
 * happen, but cheap insurance).
 */
function deriveOpenTabs(state: SessionsState): SessionsController["openTabs"] {
  const result: SessionsController["openTabs"] = [];
  for (const id of state.openTabIds) {
    const found = state.sessions.find((s) => s.id === id);
    if (found) result.push(found);
  }
  return result;
}

/**
 * Read the sessions runtime state + actions. Must be called from a
 * subtree wrapped in ``<SessionsProvider>``.
 *
 * The returned controller has stable method references (the store
 * issues them once); the state fields update reactively on every
 * commit.
 */
export function useSessions(): SessionsController {
  const store = useContext(SessionsStoreContext);
  if (!store) {
    throw new Error(
      "useSessions() must be called from a subtree wrapped in <SessionsProvider>.",
    );
  }
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  // ``openTabs`` is purely derived; recompute when state changes.
  // useMemo here is mostly for reference stability so downstream
  // memoization doesn't churn.
  const openTabs = useMemo(() => deriveOpenTabs(state), [state]);

  // Spread state + derived + actions. State fields are widened to
  // mutable arrays at the type level (the controller signature) so
  // existing consumer code that calls `.slice()` / spread keeps
  // compiling; the actual arrays are still treated immutably by the
  // store.
  return {
    ready: state.ready,
    sessions: state.sessions as SessionsController["sessions"],
    openTabIds: state.openTabIds as SessionsController["openTabIds"],
    openTabs,
    activeId: state.activeId,
    activeMessages:
      state.activeMessages as SessionsController["activeMessages"],
    setActiveMessages: store.setActiveMessages,
    ensureActive: store.ensureActive,
    openTab: store.openTab,
    closeTab: store.closeTab,
    closeTabs: store.closeTabs,
    switchToTab: store.switchToTab,
    deselect: store.deselect,
    createNew: store.createNew,
    setAgentContext: store.setAgentContext,
    importSession: store.importSession,
    rename: store.rename,
    setPinned: store.setPinned,
    setArchived: store.setArchived,
    bulkUpdate: store.bulkUpdate,
    branchSession: store.branchSession,
    rewindSession: store.rewindSession,
    restoreSession: store.restoreSession,
    exportSession: store.exportSession,
    importSessions: store.importSessions,
    searchHistory: store.searchHistory,
    resolveUserMessageId: store.resolveUserMessageId,
    markUnread: store.markUnread,
    markRead: store.markRead,
    remove: store.remove,
    clearActiveMessages: store.clearActiveMessages,
    touchSession: store.touchSession,
    applyAutoTitle: store.applyAutoTitle,
    flushPersist: store.flushPersist,
    refresh: store.refresh,
  };
}
