/**
 * Capability interfaces for extension-only features in <ChatSurface>.
 *
 * Each capability is optional. The extension provides implementations
 * (backed by chrome.* APIs); the desktop app leaves them undefined and
 * the corresponding UI hides at render time.
 *
 *   - `pageContext`            — live page chip + pinned page snapshots
 *                                 (browser-only — desktop has no concept of
 *                                 "the currently visible web page").
 *   - `learn`                  — record/playback of in-page user actions
 *                                 (browser-only — needs chrome.scripting).
 *   - `navigateOpenPolicy`     — controls where `my_browser_navigate` and
 *                                 friends open URLs (browser-only).
 *   - `openSettings`           — TabBar's gear icon. Extension calls
 *                                 `chrome.runtime.openOptionsPage()`;
 *                                 desktop opens a separate BrowserWindow.
 *   - `drainPendingPrompt`     — extension only — Home page parks a prompt
 *                                 in storage and the side panel auto-fires
 *                                 it on mount.
 */

import type { ChatMessage } from "@hermes-x/core"

// ---------------------------------------------------------------------------
// page-context
// ---------------------------------------------------------------------------

/** A captured snapshot of a web page. Mirrors `PageContext` in extension. */
export interface PageContextSnapshot {
  url?: string
  title?: string
  favIconUrl?: string
  text?: string
  html?: string
  [k: string]: unknown
}

export interface ActiveTabInfo {
  id?: number
  url?: string
  title?: string
  favIconUrl?: string
}

/**
 * Frozen view of "the page the user was looking at when they sent". The
 * client PUTs this into the backplane's ``/hermes/turn-metadata`` side
 * channel under ``browser_tab_snapshot``; the agent's
 * ``my_browser_active_tab`` tool fetches it back over loopback and
 * returns it for the entire turn — even if the user has since switched
 * tabs. Shape mirrors the live ``my_browser_active_tab`` response so
 * the handler substitutes verbatim.
 */
export interface BrowserTabSnapshot {
  tab_id?: number
  window_id?: number
  url?: string
  title?: string
  favicon?: string
  text?: string
  truncated?: boolean
  full_length?: number
  captured_at: number
}

export interface PageContextCapability {
  /** Capture the currently active page. Returns null if unavailable. */
  capturePage(): Promise<PageContextSnapshot | null>
  /** Get current active browser tab metadata. */
  getActiveBrowserTab(): Promise<ActiveTabInfo | null>
  /**
   * Capture a per-turn snapshot of the currently active tab (id + url +
   * title + extracted text), returned in the wire shape the agent's
   * ``my_browser_active_tab`` tool expects. Called at send time so the
   * agent sees a frozen view for the whole turn. Returns null when the
   * tab is restricted (chrome://, etc.) or capture fails — the agent then
   * falls back to its live behaviour.
   */
  captureBrowserTabSnapshot(): Promise<BrowserTabSnapshot | null>
  /** Format pinned + live context for inclusion in a chat prompt. */
  formatPageContextsForPrompt(snapshots: PageContextSnapshot[]): string
  /** "This page can't be captured because…" — or null when capture is OK. */
  getPageRestrictedReason(url: string | undefined): string | null
  /**
   * React hook: live-tracking the user's currently active tab. Returns the
   * latest `tab` info and a `refresh()` to force a re-read. Must be a
   * stable function reference across renders (rules of hooks).
   */
  useActiveTab(): { tab: ActiveTabInfo | null; refresh: () => void }
}

// ---------------------------------------------------------------------------
// learn
// ---------------------------------------------------------------------------

export interface LearnStatus {
  active: boolean
  eventCount: number
}

export interface LearnTraceResult {
  ok: boolean
  trace?: unknown
  error?: string
}

export interface LearnCapability {
  getStatus(): Promise<LearnStatus>
  start(tabId: number): Promise<{ ok: boolean; error?: string }>
  stop(): Promise<LearnTraceResult>
  /** Subscribe to live status broadcasts; returns unsubscribe. */
  onStateChange(cb: (status: LearnStatus) => void): () => void
}

// ---------------------------------------------------------------------------
// navigateOpenPolicy
// ---------------------------------------------------------------------------

export type NavigateOpenPolicy = "auto" | "agent" | "user_new_tab" | "user_same_tab"

export interface NavigateOpenPolicyCapability {
  /** Apply the policy + broadcast the change to anyone interested (e.g. SW). */
  apply(policy: NavigateOpenPolicy): Promise<void>
  /** Subscribe to changes coming from other surfaces (e.g. Options page). */
  onChange(cb: (policy: NavigateOpenPolicy) => void): () => void
}

// ---------------------------------------------------------------------------
// approval flow
// ---------------------------------------------------------------------------

/**
 * The composer's approval banner needs to POST decisions back to the gateway
 * (`/v1/runs/{runId}/approval`). Both apps share `postHermesApprovalDecision`
 * from @hermes-x/core, but they bind it differently — extension reaches
 * through the same backplane the SW uses; desktop reaches through main's
 * backplane. Default impl provided in @hermes-x/core is fine for both,
 * so this isn't a capability — just noting it lives in core.
 */

// ---------------------------------------------------------------------------
// pending prompt
// ---------------------------------------------------------------------------

/**
 * Lightweight attachment descriptor for a queued hand-off. Mirrors the
 * core `FileAttachment` shape closely enough that the side panel can
 * promote one straight into the live composer attachment list, but
 * without the heavy `File` reference or `uploading` flag — anything
 * that's parked in storage is already settled.
 */
export interface PendingPromptAttachment {
  uiId: string
  name: string
  mime: string
  size: number
  kind: "image" | "text" | "pdf" | "binary"
  /** Absolute path to a file the agent can read from. */
  path: string
  thumbDataUrl?: string
  textPreview?: string
}

export interface PendingPromptResult {
  /** Prefill text for the composer. Optional — a snip-only hand-off has none. */
  text?: string
  /** Attachments to pre-populate alongside the text. */
  attachments?: PendingPromptAttachment[]
  /**
   * Human-readable origin hint (e.g. "Safari", "VS Code") shown in the
   * composer header. Only set by Quick-Ask Spotlight on macOS today.
   */
  sourceApp?: string
}

export interface PendingPromptCapability {
  /**
   * Drain a queued home-launcher / external-inbox prompt and return its
   * payload for autosend.
   *
   * Returning a plain string is still supported for backward-compat with
   * older surfaces that haven't migrated; callers should treat that as
   * `{ text }` with no attachments.
   */
  drain(): Promise<PendingPromptResult | string | null>
  /**
   * Optional subscription so the chat surface can re-drain when a NEW
   * payload lands while it's already mounted. Without this the
   * once-on-mount + once-per-activeId drain misses the case where the
   * embedded ``<HomeView panelMode />`` empty-state composer submits
   * into an already-active empty session — activeId doesn't flip, so
   * the autosend wouldn't fire.
   *
   * Returns an unsubscribe callback. Hosts that don't implement push
   * notifications can simply omit this.
   */
  subscribe?(onChanged: () => void): () => void
}

// ---------------------------------------------------------------------------
// composed bundle
// ---------------------------------------------------------------------------

export interface ChatSurfaceCapabilities {
  pageContext?: PageContextCapability
  learn?: LearnCapability
  navigateOpenPolicy?: NavigateOpenPolicyCapability
  pendingPrompt?: PendingPromptCapability
}

/**
 * Helper for extensions: format pinned pages alongside user prompt text
 * for engine submit. Desktop never has page context so it just returns the
 * user text. Caller binds `formatPageContextsForPrompt` from page-context
 * capability if present.
 */
export function buildHistoryWithPageContext(
  baseHistory: ChatMessage[],
  userText: string,
  pageSnapshots: PageContextSnapshot[],
  pageContext?: PageContextCapability
): ChatMessage[] {
  let augmented = userText
  if (pageContext && pageSnapshots.length > 0) {
    const ctx = pageContext.formatPageContextsForPrompt(pageSnapshots)
    if (ctx) augmented = `${ctx}\n\n${userText}`
  }
  return [...baseHistory, { role: "user", content: augmented }]
}
