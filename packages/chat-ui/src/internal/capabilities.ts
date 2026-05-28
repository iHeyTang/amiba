/**
 * Capability interfaces for extension-only features in <SidePanelView>.
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

export interface PageContextCapability {
  /** Capture the currently active page. Returns null if unavailable. */
  capturePage(): Promise<PageContextSnapshot | null>
  /** Get current active browser tab metadata. */
  getActiveBrowserTab(): Promise<ActiveTabInfo | null>
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

export interface PendingPromptCapability {
  /** Drain a queued home-launcher prompt, if any, and return it for autosend. */
  drain(): Promise<string | null>
}

// ---------------------------------------------------------------------------
// composed bundle
// ---------------------------------------------------------------------------

export interface SidePanelCapabilities {
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
