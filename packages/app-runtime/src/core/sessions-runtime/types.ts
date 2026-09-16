/**
 * Public types for the sessions runtime.
 *
 * Kept separate from the store/provider implementation so consumer
 * packages (`chat-ui`, `home-ui`, ...) can import only the shape they
 * need without dragging React in.
 */

import type { Dispatch, SetStateAction } from "react";

import type { SessionMessage, SessionMeta } from "../sessions";
import type { AgentExecutionContext } from "../agent-context";

/**
 * Immutable snapshot of the session-runtime's reactive state. Returned
 * by ``store.getSnapshot()`` and what ``useSessions()`` observes via
 * ``useSyncExternalStore``.
 *
 * All collections are typed as ``ReadonlyArray<...>`` to encourage
 * immutable handling at the call site — mutations always flow through
 * the store's action methods, which produce a fresh snapshot.
 */
export type SessionLoadState =
  | { sessionId: string; status: "loading" }
  | { sessionId: string; status: "error"; message: string };

export interface SessionsState {
  readonly sessionLoad?: SessionLoadState;
  readonly ready: boolean;
  readonly sessions: ReadonlyArray<SessionMeta>;
  readonly openTabIds: ReadonlyArray<string>;
  readonly activeId: string;
  readonly activeMessages: ReadonlyArray<SessionMessage>;
}

/**
 * Public controller surface returned by ``useSessions()``. State fields
 * mirror ``SessionsState`` but are widened to mutable array types so
 * existing consumer code (which spreads + slices freely) continues to
 * compile. The store still produces immutable snapshots; the widening
 * is purely a type ergonomics affordance.
 *
 * Action methods are stable references across renders — the store
 * issues them once at construction time.
 */
export interface SessionsController {
  sessionLoad?: SessionLoadState;
  /** Current authoritative state for asynchronous target-addressed operations. */
  getSnapshot: () => SessionsState;
  /** True once the DSH session projection is loaded. */
  ready: boolean;
  /** Every session in storage (the History view). */
  sessions: SessionMeta[];
  /** Ordered ids of sessions currently shown as tabs in the header. */
  openTabIds: string[];
  /** Derived: `openTabIds` resolved to SessionMeta, dangling refs filtered. */
  openTabs: SessionMeta[];
  activeId: string;
  activeMessages: SessionMessage[];

  /**
   * Update the messages of the currently active session. Accepts either
   * a value or a functional updater (``(prev) => next``) so consumers
   * can interleave their own appends with the store's. Idempotent if
   * the resulting array is referentially identical.
   *
   * The signature matches ``React.Dispatch<SetStateAction<...>>`` so
   * call sites that previously assumed the raw ``useState`` dispatcher
   * shape keep compiling.
   */
  setActiveMessages: Dispatch<SetStateAction<SessionMessage[]>>;
  /** Returns false without invoking the updater when another session is selected. */
  updateActiveMessagesFor: (sessionId: string, action: (prev: SessionMessage[]) => SessionMessage[]) => boolean;

  /** Returns the active id, creating + opening a new tab if there's none. */
  ensureActive: () => Promise<string>;

  /**
   * Open the session as a tab (appending if not already open) and
   * activate it. Used when picking a session from History.
   */
  openTab: (id: string, subagent?: SessionMeta["subagentAddress"]) => Promise<void>;

  /**
   * Close the tab without touching the underlying session. If `id` was
   * the active tab, switches to the nearest neighbour (right first,
   * then left, then empty).
   */
  closeTab: (id: string) => Promise<void>;

  /**
   * Bulk close. Atomic — single state transition, at most one active
   * switch, so it avoids the snapshot-staleness a loop of ``closeTab``
   * would hit.
   */
  closeTabs: (ids: string[]) => Promise<void>;

  /**
   * Switch the active tab to one that's already open. (UI: clicking on
   * a tab in the tab bar.)
   */
  switchToTab: (id: string) => Promise<void>;

  /**
   * Clear the active selection without closing any tabs. The chat
   * surface falls back to the empty/home state. Symmetrical with
   * picking a row — the rail uses it for the "click selected row to
   * deselect" UX.
   */
  deselect: () => Promise<void>;

  /** Create a fresh session, open it as a tab, and activate it. */
  createNew: (agent?: AgentExecutionContext) => Promise<string>;

  /** Bind the DSH preset used by this task before the first user message. */
  setAgentContext: (id: string, agent: AgentExecutionContext) => Promise<void>;

  rename: (id: string, title: string) => Promise<void>;

  /**
   * Archive on the host (DSH `workspace.archiveSession`). One-way: DSH has
   * no unarchive RPC yet, and Amiba has no session delete at all — the log
   * survives, and the archived view still opens it.
   */
  archiveSession: (id: string) => Promise<void>;
  /** Batch form of {@link archiveSession}, for the list's selection mode. */
  archiveSessions: (ids: string[]) => Promise<void>;
  branchSession: (id: string, messageId?: number) => Promise<string>;
  exportSession: (id: string) => Promise<Record<string, unknown>>;
  searchHistory: (query: string) => Promise<SessionMeta[]>;
  resolveUserMessageId: (id: string, userOrdinal: number) => Promise<number | null>;

  /** Mark a background session as having an update the user has not opened. */
  markUnread: (id: string, activityAt?: number) => Promise<void>;

  /** Clear the local unread marker. Opening a session calls this automatically. */
  markRead: (id: string, activityAt?: number) => Promise<void>;

  clearActiveMessages: () => Promise<void>;

  /**
   * Bump ``updatedAt`` + ``messageCount`` for a session, and (when the
   * title is still the default and not user-pinned) regenerate it from
   * the current messages.
   */
  touchSession: (id: string, messages: SessionMessage[]) => Promise<void>;

  /**
   * Apply a backend-generated auto-title to a session. No-op when the
   * session already has a non-empty manual title.
   */
  applyAutoTitle: (id: string, title: string) => Promise<void>;

  /**
   * Immediately persist the active session's messages, skipping the
   * 250ms debounce. Used from "turn just completed" boundaries.
   */
  flushPersist: () => Promise<void>;

  /**
   * Re-fetch the native DSH session index, including sessions created by
   * plugins or other DSH clients.
   */
  recoverMessages: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}
