/**
 * SessionsStore — vanilla (non-React) state container for the sessions
 * runtime. ONE instance per page, mounted via ``<SessionsProvider>``.
 *
 * Design goals:
 *
 *   1. **Single source of truth.** State lives in this class, not in
 *      duplicated React `useState`s sprinkled across the components
 *      that need it. Eliminates the cross-instance broadcast races
 *      that plagued the previous hook-per-consumer architecture.
 *
 *   2. **Immutable snapshots.** ``getSnapshot()`` returns a frozen
 *      reference that only changes when state actually changes —
 *      ``useSyncExternalStore`` consumers can rely on referential
 *      equality to skip re-renders.
 *
 *   3. **Synchronous mutation, asynchronous persistence.** Action
 *      methods commit their state change inline, then schedule
 *      ``saveMessages`` / ``saveIndex`` / ... behind a debounce. The
 *      UI never waits on storage I/O to reflect a click.
 *
 *   4. **Echo-filtering by content hash.** After each write we stash
 *      ``JSON.stringify(value)`` of what we wrote. The cross-window
 *      storage watcher compares the broadcast value against the last
 *      stashed hash; matches are dropped as our own echo. No
 *      self-write counter / per-id Map — one hash per key is enough
 *      because writes to the same key are sequenced.
 *
 *   5. **One async-load critical section.** The only path that
 *      ``await``s in the middle of a state transition is "external
 *      page switched activeId → load that session's messages". Guarded
 *      by a monotonic ``switchToken``; any later transition cancels
 *      the in-flight load by bumping it.
 *
 * What's gone vs. the old hook:
 *
 *   - ``selfWriteActiveIdRef`` Map + mark/consume counters → replaced
 *     by hash-based echo filtering.
 *   - 5 React refs (``sessionsRef`` / ``openTabIdsRef`` / ... ) →
 *     state lives here directly; no syncing needed.
 *   - 6 ``useEffect`` blocks (ref-sync × 4 + persist × 3 + watch) →
 *     replaced by explicit lifecycle methods + sync mutators.
 *   - Per-call ``markSelfWriteActiveId`` ceremony → gone.
 */

import { getPlatform, type StorageChangeMap } from "@amiba/app-runtime/platform";

import {
  normalizeAgentContext,
  normalizeAgentProfileId,
  type AgentExecutionContext,
} from "../agent-context";
import {
  SESSION_KEYS,
  type SessionMessage,
  type SessionMeta,
} from "../sessions";
import {
  archiveSession as archiveHostSession,
  deriveTitleFromMessages,
  loadIndex,
  loadSessionMeta,
  loadMessages,
  newSessionMeta,
  saveIndex,
  saveMessages,
  searchIndex,
} from "./store";
import type { SessionsState } from "./types";

const PERSIST_DEBOUNCE_MS = 250;

const INITIAL_STATE: SessionsState = Object.freeze({
  ready: false,
  sessions: [],
  openTabIds: [],
  activeId: "",
  activeMessages: [],
});

type Listener = () => void;

export class SessionsStore {
  // -------------------------------------------------------------------------
  // Reactive state
  // -------------------------------------------------------------------------

  private state: SessionsState = INITIAL_STATE;
  private listeners: Set<Listener> = new Set();

  // -------------------------------------------------------------------------
  // Async-load guard
  // -------------------------------------------------------------------------

  /**
   * Monotonic counter. Any state transition that changes ``activeId``
   * (or that wants to invalidate an in-flight async load) bumps this.
   * The cross-window-activeId-broadcast handler is the only path that
   * actually checks it — its ``await loadMessages`` resolves into a
   * stale closure when the user has since moved on.
   */
  private switchToken = 0;

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Hash of the last value we wrote to ``sessions.index``. The index is
   * the ONE piece of state that's shared cross-window (it's the global
   * DSH session projection plus local presentation metadata). Comparing
   * incoming broadcasts against this lets us swallow our own echo —
   * other windows' edits still flow in.
   *
   * ``activeId`` and ``openTabIds`` are per-window in-memory only, so they
   * do not need a hash filter (there is no persisted broadcast to filter).
   */
  private lastWrittenIndexHash = "";

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  private storageWatchUnsubscribe: (() => void) | null = null;
  private initialized = false;
  private initializing: Promise<void> | null = null;

  // -------------------------------------------------------------------------
  // useSyncExternalStore contract
  // -------------------------------------------------------------------------

  /**
   * Subscribe to state changes. Returns an unsubscribe callback. The
   * listener is invoked once per state transition; it should call
   * ``getSnapshot()`` for the new state.
   */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Return the current immutable state. Reference is stable until the
   * next transition.
   */
  getSnapshot = (): SessionsState => this.state;

  // -------------------------------------------------------------------------
  // Lifecycle — initialize / teardown
  // -------------------------------------------------------------------------

  /**
   * Load persisted state + start the cross-window watcher. Idempotent:
   * concurrent callers share the same promise; subsequent calls after
   * initialization completes are no-ops.
   */
  initialize = async (): Promise<void> => {
    if (this.initialized) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.runInitialize();
    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  };

  private async runInitialize(): Promise<void> {
    const idx = await loadIndex();

    // Per-window state starts EMPTY on every mount. ``activeId`` and
    // ``openTabIds`` are intentionally not persisted — each browser
    // window / chat tab gets a clean slate and chooses its own
    // session. Cross-window selection sync was the source of the
    // "switching a session in one window jerks the other window
    // around" UX bug; per-window in-memory state cleans it up at the
    // root.
    //
    // The global ``sessions.index`` IS still cross-window — it's the
    // shared "all sessions ever" list backed by SessionDB. Other
    // windows' edits flow in via the storage watcher below.
    this.lastWrittenIndexHash = JSON.stringify(idx);

    this.commit({
      ready: true,
      sessions: idx,
      openTabIds: [],
      activeId: "",
      activeMessages: [],
    });

    this.storageWatchUnsubscribe = getPlatform().storage.watch(
      [SESSION_KEYS.index],
      this.onStorageChange,
    );

    this.initialized = true;
  }

  /** Stop the cross-window watcher; drop pending persistence. */
  teardown = (): void => {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.storageWatchUnsubscribe) {
      this.storageWatchUnsubscribe();
      this.storageWatchUnsubscribe = null;
    }
    this.listeners.clear();
    this.initialized = false;
  };

  // -------------------------------------------------------------------------
  // State transition
  // -------------------------------------------------------------------------

  private commit(patch: Partial<SessionsState>): void {
    const next: SessionsState = { ...this.state, ...patch };
    if (
      next.ready === this.state.ready &&
      next.sessions === this.state.sessions &&
      next.openTabIds === this.state.openTabIds &&
      next.activeId === this.state.activeId &&
      next.activeMessages === this.state.activeMessages
    ) {
      // Nothing actually changed (reference-equal).
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  // -------------------------------------------------------------------------
  // Persistence helpers
  // -------------------------------------------------------------------------

  private async persistIndex(next: ReadonlyArray<SessionMeta>): Promise<void> {
    const snapshot = JSON.stringify(next);
    this.lastWrittenIndexHash = snapshot;
    await saveIndex(next as SessionMeta[]);
  }

  private schedulePersistMessages(): void {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const id = this.state.activeId;
    if (!id) return;
    const messages = this.state.activeMessages;
    const token = this.switchToken;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      // Session switch happened during the debounce — the (id, snapshot)
      // pair no longer represents a coherent view. The pre-switch flush
      // already saved this session's outgoing state.
      if (token !== this.switchToken) return;
      void saveMessages(id, messages as SessionMessage[]);
    }, PERSIST_DEBOUNCE_MS);
  }

  /**
   * Force the active session's messages to storage NOW. Used by
   * callers crossing a boundary that could otherwise lose the
   * debounced write (tab close, post-stream teardown).
   */
  flushPersist = async (): Promise<void> => {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const id = this.state.activeId;
    if (!id) return;
    await saveMessages(id, this.state.activeMessages as SessionMessage[]);
  };

  /**
   * Re-fetch the session index from DSH. Called from
   * surfaces that need to pick up multi-channel rows authored elsewhere
   * (DSH plugins, schedules, CLI, etc.) without waiting for the next storage-watch
   * broadcast.
   *
   * Treats the freshly fetched list the same way the cross-window
   * watcher does: update history while retaining open sessions that have
   * not appeared in the host history yet. When nothing changed, the
   * commit short-circuits via the reference-equality guard.
   */
  private refreshRevision = 0;

  refresh = async (): Promise<void> => {
    if (!this.initialized) return;
    const revision = ++this.refreshRevision;
    const before = new Map(this.state.sessions.map((session) => [session.id, session]));
    const loaded = await loadIndex();
    if (revision !== this.refreshRevision) return;
    // A viewer may open a result while the host list request is in flight.
    // Keep local acknowledgements made AFTER that request started.
    const current = new Map(this.state.sessions.map((session) => [session.id, session]));
    const next = loaded.map((session) => {
      const latest = current.get(session.id);
      const previous = before.get(session.id);
      if (latest && (latest.readAt !== previous?.readAt || latest.unread !== previous?.unread)) {
        return { ...session, readAt: latest.readAt, unread: latest.unread };
      }
      return session;
    });
    const snapshot = JSON.stringify(next);
    if (snapshot === this.lastWrittenIndexHash) return;
    this.lastWrittenIndexHash = snapshot;
    this.applyExternalIndex(next);
  };

  // -------------------------------------------------------------------------
  // Cross-window storage watcher
  // -------------------------------------------------------------------------

  /**
   * Only ``sessions.index`` is cross-window. When another window mints
   * a new session, renames one, or deletes one, the broadcast lands
   * here. We reflect history changes without letting a partial index
   * discard this window's open drafts or selection.
   */
  private onStorageChange = (changes: StorageChangeMap): void => {
    const indexChange = changes[SESSION_KEYS.index];
    if (!indexChange) return;
    const v = indexChange.newValue;
    if (!Array.isArray(v)) return;
    const snapshot = JSON.stringify(v);
    if (snapshot === this.lastWrittenIndexHash) return;
    this.lastWrittenIndexHash = snapshot;
    this.applyExternalIndex(v as SessionMeta[]);
  };

  /**
   * The history index excludes blank host sessions and local drafts that
   * only materialize on first submit. Absence is not a deletion signal
   * (DSH supports archiving, not deletion). Retain missing open rows until
   * the host supplies their metadata; selection and messages stay local.
   */
  private applyExternalIndex(next: SessionMeta[]): void {
    const known = new Set(next.map((session) => session.id));
    const open = new Set(this.state.openTabIds);
    if (this.state.activeId) open.add(this.state.activeId);
    const retained = this.state.sessions.filter(
      (session) => open.has(session.id) && !known.has(session.id),
    );
    this.commit({ sessions: retained.length ? [...retained, ...next] : next });
    for (const [id, activityAt] of this.pendingUnread) {
      if (!known.has(id)) continue;
      this.pendingUnread.delete(id);
      void this.markUnread(id, activityAt);
    }
  }

  // -------------------------------------------------------------------------
  // Action: setActiveMessages (Dispatch<SetStateAction<...>> compatible)
  // -------------------------------------------------------------------------

  setActiveMessages = (
    action: SessionMessage[] | ((prev: SessionMessage[]) => SessionMessage[]),
  ): void => {
    const current = this.state.activeMessages as SessionMessage[];
    const next = typeof action === "function" ? action(current) : action;
    if (next === current) return;
    this.commit({ activeMessages: next });
    this.schedulePersistMessages();
  };

  // -------------------------------------------------------------------------
  // Action: active-id transitions
  // -------------------------------------------------------------------------

  /**
   * Switch to ``id`` (which must already be in ``openTabIds``) and
   * load its messages. ``activeId`` is per-window in-memory state, so
   * no persistence is involved — the commit is purely local.
   */
  private async activateOpen(id: string, token = ++this.switchToken, reload = false): Promise<void> {
    if (token !== this.switchToken) return;
    if (!id) {
      // Returning to Home is a UI state transition, so publish it before
      // waiting for the outgoing session's best-effort persistence. This is
      // especially important when a live turn is being aborted: the DSH
      // cancellation/flush can be slow, but it must never leave the
      // composer visually attached to the conversation the user just left.
      const flush = this.flushActiveBeforeSwitch();
      this.commit({ activeId: "", activeMessages: [] });
      await flush;
      return;
    }
    if (id === this.state.activeId && !reload) {
      await this.markRead(id);
      return;
    }
    await this.flushActiveBeforeSwitch();
    if (token !== this.switchToken) return;
    const next = await loadMessages(id, this.state.sessions.find((session) => session.id === id)?.subagentAddress);
    if (token !== this.switchToken) return;
    this.commit({ activeId: id, activeMessages: next });
    await this.markRead(id);
  }

  /**
   * Persist the active session's messages before we switch away — the
   * post-switch debounced persist effect won't fire for the outgoing
   * id, so any pending edits would otherwise be lost.
   */
  private async flushActiveBeforeSwitch(): Promise<void> {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    const id = this.state.activeId;
    if (!id) return;
    await saveMessages(id, this.state.activeMessages as SessionMessage[]);
  }

  switchToTab = async (id: string): Promise<void> => {
    if (!this.state.openTabIds.includes(id)) return;
    await this.activateOpen(id);
  };

  /**
   * Drop the active selection without closing any tabs. The chat
   * surface falls back to the empty/home state. Used by the rail's
   * "click selected row to deselect" UX — symmetrical with picking a
   * row to select.
   */
  deselect = async (): Promise<void> => {
    // Also cancel a pending open when Home is still the visible state.
    await this.activateOpen("");
  };

  openTab = async (id: string, subagent?: SessionMeta["subagentAddress"]): Promise<void> => {
    if (!id) return;
    const token = ++this.switchToken;
    const previousAddress = this.state.sessions.find((session) => session.id === id)?.subagentAddress;
    if (subagent || !this.state.sessions.some((session) => session.id === id)) {
      // Open-by-id may target a session the history index dropped (a host-
      // or plugin-created session with no user turn yet). Surface its real
      // identity — the agent preset it already runs, its title — before it
      // becomes active, or the composer would treat it as a fresh draft.
      const meta = await loadSessionMeta(id, subagent);
      if (token !== this.switchToken) return;
      if (meta) this.commit({ sessions: this.state.sessions.some((session) => session.id === id)
        ? this.state.sessions.map((session) => session.id === id ? { ...session, subagentAddress: meta.subagentAddress, parentSessionId: meta.parentSessionId } : session)
        : [meta, ...this.state.sessions] });
    }
    if (!this.state.openTabIds.includes(id)) {
      // Append at the end so existing tabs keep their relative order.
      const nextTabs = [...this.state.openTabIds, id];
      this.commit({ openTabIds: nextTabs });
    }
    const address = this.state.sessions.find((session) => session.id === id)?.subagentAddress;
    await this.activateOpen(id, token, JSON.stringify(previousAddress) !== JSON.stringify(address));
  };

  closeTab = async (id: string): Promise<void> => {
    const tabs = this.state.openTabIds;
    const i = tabs.indexOf(id);
    if (i < 0) return;
    const remaining = tabs.slice(0, i).concat(tabs.slice(i + 1));
    this.commit({ openTabIds: remaining });
    if (id === this.state.activeId) {
      const replacement = remaining[i] ?? remaining[i - 1] ?? "";
      await this.activateOpen(replacement);
    }
  };

  closeTabs = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const toClose = new Set(ids);
    const tabs = this.state.openTabIds;
    const remaining = tabs.filter((id) => !toClose.has(id));
    if (remaining.length === tabs.length) return;
    this.commit({ openTabIds: remaining });

    const activeId = this.state.activeId;
    if (activeId && toClose.has(activeId)) {
      const i = tabs.indexOf(activeId);
      let replacement = "";
      for (let j = i + 1; j < tabs.length; j++) {
        if (!toClose.has(tabs[j])) {
          replacement = tabs[j];
          break;
        }
      }
      if (!replacement) {
        for (let j = i - 1; j >= 0; j--) {
          if (!toClose.has(tabs[j])) {
            replacement = tabs[j];
            break;
          }
        }
      }
      await this.activateOpen(replacement);
    }
  };

  // -------------------------------------------------------------------------
  // Action: createNew + ensureActive
  // -------------------------------------------------------------------------

  createNew = async (agent?: AgentExecutionContext): Promise<string> => {
    await this.flushActiveBeforeSwitch();
    const meta = newSessionMeta({ agent });
    ++this.switchToken;
    const nextSessions = [meta, ...this.state.sessions];
    const nextTabs = [...this.state.openTabIds, meta.id];
    this.commit({
      sessions: nextSessions,
      openTabIds: nextTabs,
      activeId: meta.id,
      activeMessages: [],
    });
    // Only the index is shared cross-window; ``openTabIds`` and
    // ``activeId`` are window-local in-memory state and never written
    // to storage. Other windows will see this new session appear in
    // their rail via the broadcast, but won't auto-activate it —
    // selection is per-window.
    await this.persistIndex(nextSessions);
    return meta.id;
  };

  ensureActive = async (): Promise<string> => {
    if (this.state.activeId) return this.state.activeId;
    return this.createNew();
  };

  setAgentContext = async (
    id: string,
    agent: AgentExecutionContext,
  ): Promise<void> => {
    const idx = this.state.sessions.findIndex((session) => session.id === id);
    if (idx < 0) return;
    const normalized = normalizeAgentContext(agent);
    const current = this.state.sessions[idx];
    if (JSON.stringify(current.agent ?? null) === JSON.stringify(normalized)) {
      return;
    }
    const previousProfileId = normalizeAgentProfileId(current.agent?.profileId);
    if (
      previousProfileId !== normalized.profileId &&
      (current.messageCount ?? 0) > 0
    ) {
      return;
    }
    // DSH binds the preset when the real session is created by the first
    // submit. A blank task is local presentation state, so changing its
    // preset requires no runtime mutation.
    const next = this.state.sessions.slice();
    next[idx] = {
      ...current,
      agent: normalized,
      updatedAt: Date.now(),
    };
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };

  // -------------------------------------------------------------------------
  // Action: rename / archive / titles
  // -------------------------------------------------------------------------

  rename = async (id: string, title: string): Promise<void> => {
    const trimmed = title.trim();
    const idx = this.state.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const cur = this.state.sessions[idx];
    if (cur.title === trimmed && cur.titleManual) return;
    const next = this.state.sessions.slice();
    next[idx] = {
      ...cur,
      title: trimmed,
      titleManual: true,
      updatedAt: Date.now(),
    };
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };

  /**
   * Archive on the HOST. DSH owns the archive set (`workspace.archiveSession`
   * answers with the full updated set, and pushes it to every other client),
   * so nothing about it is persisted locally — the reply is projected onto
   * the in-memory index and that is the whole write.
   *
   * There is no unarchive: DSH does not offer one yet. Archiving is the only
   * "get this out of my list" action Amiba has, and it is not destructive —
   * the session log survives and the archived view still opens it.
   */
  archiveSession = async (id: string): Promise<void> => {
    if (!id) return;
    this.applyArchivedSet(await archiveHostSession(id));
    if (this.state.openTabIds.includes(id)) await this.closeTab(id);
  };

  /** Batch archive. Sequential so one failure cannot orphan the rest. */
  archiveSessions = async (ids: string[]): Promise<void> => {
    for (const id of Array.from(new Set(ids)).filter(Boolean)) {
      await this.archiveSession(id);
    }
  };

  /** Project the host's archive set onto the in-memory index. */
  private applyArchivedSet(archivedIds: ReadonlySet<string>): void {
    let changed = false;
    const next = this.state.sessions.map((session) => {
      const archived = archivedIds.has(session.id) ? true : undefined;
      if (Boolean(session.archived) === Boolean(archived)) return session;
      changed = true;
      return { ...session, archived };
    });
    if (changed) this.commit({ sessions: next });
  }

  branchSession = async (id: string, messageId?: number): Promise<string> => {
    const runtime = getPlatform().agentSessions;
    if (!runtime) throw new Error("DSH sessions are unavailable.");
    const response = await runtime.fork(id, messageId);
    await this.refresh();
    await this.openTab(response.sessionId);
    return response.sessionId;
  };

  exportSession = async (id: string): Promise<Record<string, unknown>> => {
    const session = this.state.sessions.find((item) => item.id === id);
    return {
      export_version: 2,
      runtime: "dsh",
      session: { ...session, messages: await loadMessages(id, session?.subagentAddress) },
    };
  };

  searchHistory = async (query: string): Promise<SessionMeta[]> =>
    searchIndex(query);

  resolveUserMessageId = async (
    id: string,
    userOrdinal: number,
  ): Promise<number | null> => {
    const messages = await loadMessages(id, this.state.sessions.find((session) => session.id === id)?.subagentAddress);
    const message = messages.filter((item) => item.role === "user")[userOrdinal] as
      | (SessionMessage & { runtimeSeq?: number })
      | undefined;
    return message?.runtimeSeq ?? null;
  };

  // -------------------------------------------------------------------------
  // Action: local unread state
  // -------------------------------------------------------------------------

  private readonly pendingUnread = new Map<string, number>();

  markUnread = async (id: string, activityAt = Date.now()): Promise<void> => {
    if (!this.state.ready) await this.initialize();
    // Visibility belongs to the caller: an active tab can be behind another view.
    if (!id) return;
    const idx = this.state.sessions.findIndex((session) => session.id === id);
    if (idx < 0) {
      this.pendingUnread.set(id, Math.max(activityAt, this.pendingUnread.get(id) ?? 0));
      return;
    }
    if ((this.state.sessions[idx].readAt ?? -Infinity) >= activityAt || this.state.sessions[idx].unread) return;
    const next = this.state.sessions.slice();
    next[idx] = { ...next[idx], unread: true };
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };

  markRead = async (id: string, activityAt = Date.now()): Promise<void> => {
    if (!this.state.ready) await this.initialize();
    if (!id) return;
    const idx = this.state.sessions.findIndex((session) => session.id === id);
    this.pendingUnread.delete(id);
    if (idx < 0) return;
    if (!this.state.sessions[idx].unread && (this.state.sessions[idx].readAt ?? -Infinity) >= activityAt) return;
    const next = this.state.sessions.slice();
    next[idx] = { ...next[idx], unread: undefined, readAt: Math.max(activityAt, next[idx].readAt ?? -Infinity) };
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };

  clearActiveMessages = async (): Promise<void> => {
    const id = this.state.activeId;
    if (!id) return;
    const nextSessions = this.state.sessions.map((s) =>
      s.id === id ? { ...s, messageCount: 0, updatedAt: Date.now() } : s,
    );
    this.commit({ activeMessages: [], sessions: nextSessions });
    await Promise.all([
      this.persistIndex(nextSessions),
      saveMessages(id, []),
    ]);
  };

  touchSession = async (
    id: string,
    messages: SessionMessage[],
  ): Promise<void> => {
    const idx = this.state.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const cur = this.state.sessions[idx];
    const next = this.state.sessions.slice();
    const updated: SessionMeta = {
      ...cur,
      updatedAt: Date.now(),
      messageCount: messages.length,
    };
    if (!cur.titleManual && (!cur.title || cur.title === "New chat")) {
      updated.title = deriveTitleFromMessages(messages, cur.title || "");
    }
    next[idx] = updated;
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };

  applyAutoTitle = async (id: string, title: string): Promise<void> => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const idx = this.state.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const cur = this.state.sessions[idx];
    // Respect user-set titles. Short-circuit no-op writes.
    if (cur.titleManual) return;
    if ((cur.title || "").trim() === trimmed) return;
    const next = this.state.sessions.slice();
    next[idx] = { ...cur, title: trimmed, updatedAt: Date.now() };
    this.commit({ sessions: next });
    await this.persistIndex(next);
  };
}
