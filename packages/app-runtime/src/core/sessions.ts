/**
 * Session metadata — what TabBar / SessionDrawer / session list render.
 *
 * DSH owns the canonical append-only event log. Amiba keeps only the
 * presentation metadata that DSH deliberately does not model.
 */

import type { AgentExecutionContext } from "./agent-context";

export interface SessionMeta {
  id: string
  /** User-visible title; empty means "auto-generate from first user msg". */
  title: string
  createdAt: number
  /** Last activity time (last message append, last rename). */
  updatedAt: number
  archived?: boolean
  /** Branch provenance retained when this task was forked from another task. */
  parentSessionId?: string
  branchMessageId?: number
  /** Matching transcript excerpt shown while searching task history. */
  searchSnippet?: string
  /** Local viewer state; never written into the DSH event log. */
  unread?: boolean
  /** Cached count so the sidebar doesn't have to load history just to count. */
  messageCount?: number
  /**
   * Optional first-user-message preview for history/search surfaces.
   */
  preview?: string
  /** Set once the user manually renames; suppresses auto-title regeneration. */
  titleManual?: boolean
  /**
   * Originating surface for this session. DSH plugins may attach their own
   * channel/source metadata; a missing value means the local desktop UI.
   */
  source?: string
  /**
   * DSH agent preset bound to this task.
   * Stored in the local sidecar for blank tasks and projected from DSH after
   * the first submission materializes the real runtime session.
   */
  agent?: AgentExecutionContext
}

import type { ChatMessage } from "./chat-messages"

/** Readable alias used by session projections; identical to ChatMessage. */
export type SessionMessage = ChatMessage

/** UI-only per-session flags that don't have a counterpart in the engine. */
export interface SessionLocalMeta {
  archived?: boolean
  unread?: boolean
  titleManual?: boolean
  agent?: AgentExecutionContext
  parentSessionId?: string
  branchMessageId?: number
}

/**
 * Centralised storage keys so all desktop renderer surfaces stay in sync.
 * They are JSON property names in the platform storage backend.
 */
export const SESSION_KEYS = {
  /** Cross-window projection of the DSH index and local presentation fields. */
  index: "sessions.index",
} as const

/** Storage key for local-only UI metadata (archived / unread / titleManual). */
export const LOCAL_META_KEY = "sessions.local-meta" as const
