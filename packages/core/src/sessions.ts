/**
 * Session metadata — what TabBar / SessionDrawer / session list render.
 *
 * The persisted message log itself lives in each engine's storage:
 * extension → chrome.storage.local + Hermes backplane state.db;
 * desktop → Electron IPC store + Hermes backplane state.db. But the
 * UI-facing metadata shape is the same.
 */

import type { AgentExecutionContext } from "./agent-context";

export interface SessionMeta {
  id: string
  /** User-visible title; empty means "auto-generate from first user msg". */
  title: string
  createdAt: number
  /** Last activity time (last message append, last rename). */
  updatedAt: number
  pinned?: boolean
  archived?: boolean
  /** Local viewer state; never written into Hermes SessionDB. */
  unread?: boolean
  /** Cached count so the sidebar doesn't have to load history just to count. */
  messageCount?: number
  /**
   * Short first-user-message preview returned by Hermes. Kept out of normal
   * row rendering, but lets compatibility layers identify legacy structured
   * context without loading every conversation.
   */
  preview?: string
  /** Set once the user manually renames; suppresses auto-title regeneration. */
  titleManual?: boolean
  /**
   * Originating channel for this session. Mirror of SessionDB's
   * ``source`` column — used by the drawer / tab strip / read-only
   * banner to render channel badges and gate the composer. Optional
   * because legacy rows and locally-minted unflushed sessions may have
   * none; ``resolveChannel`` treats nullish as local.
   */
  source?: string
  /**
   * The Hermes runtime bound to this task. Kept in Amiba's local sidecar
   * because Hermes stores each profile in a different SessionDB rather than
   * repeating the profile id on every row.
   */
  agent?: AgentExecutionContext
}

import type { ChatMessage } from "./chat-messages"

/** Alias kept for legacy import sites; identical to ChatMessage. */
export type SessionMessage = ChatMessage

/** UI-only per-session flags that don't have a counterpart in the engine. */
export interface SessionLocalMeta {
  pinned?: boolean
  archived?: boolean
  unread?: boolean
  titleManual?: boolean
  agent?: AgentExecutionContext
}

/**
 * Centralised storage keys so all callers stay in sync. The same keys are
 * used by extension (chrome.storage.local) and desktop (Electron IPC store)
 * — they're just JSON property names in the platform's storage backend.
 */
export const SESSION_KEYS = {
  /** Legacy local-mirrored index; only read by `migrate.ts`. */
  index: "sessions.index",
  /** Legacy per-session message log; only read by `migrate.ts`. */
  message: (id: string) => `sessions.message.${id}`,
  /** IDs of the sessions currently shown as tabs, in display order. */
  openTabIds: "sessions.openTabIds",
  /** Source of truth for which session is currently displayed. */
  activeId: "sessions.activeId",
  /** Mirror of `activeId` — kept for backward compatibility. */
  legacyActiveId: "settings.chat.sessionId",
  /** Pre-multi-session schema; only read by `migrate.ts`. */
  legacyHistory: "chat.history",
  /** v0.3 → multi-session migration completion flag. */
  migrated: "sessions.migrated",
  /** Multi-session local → Hermes migration completion flag. */
  migratedToHermes: "sessions.migrated.hermes"
} as const

/** Storage key for local-only UI metadata (pinned / archived / unread / titleManual). */
export const LOCAL_META_KEY = "sessions.local-meta" as const
