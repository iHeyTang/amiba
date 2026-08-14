/**
 * Capability interfaces for extension-only behaviours in the Options panes.
 *
 * Each capability is optional. The extension provides chrome.runtime-backed
 * implementations; the desktop app leaves them undefined so the
 * corresponding UI hides at render time.
 */

// ---------------------------------------------------------------------------
// Bridge (Tampermonkey/userscript WebSocket bridge — extension-only)
// ---------------------------------------------------------------------------
export interface BridgeCapability {
  /**
   * Ask the SW to drop & re-establish the bridge WebSocket. Used by the
   * Gateway settings pane after the user updates the bridge URL.
   */
  refresh(): Promise<void>
}

// ---------------------------------------------------------------------------
// Userscripts (Tampermonkey-compatible runtime — extension-only)
// ---------------------------------------------------------------------------
export interface UserScriptSummary {
  id: string
  meta: Record<string, unknown>
  enabled: boolean
  installedAt: number
  updatedAt: number
  sourceURL?: string
  lastError?: string
}

export interface UserScriptDetail extends UserScriptSummary {
  source: string
}

export interface UserScriptCapability {
  list(): Promise<{ scripts: UserScriptSummary[] }>
  get(id: string): Promise<{ script: UserScriptDetail | null }>
  setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }>
  remove(id: string): Promise<{ ok: boolean; error?: string }>
  save(opts: {
    id?: string
    source: string
  }): Promise<{ ok: boolean; id?: string; error?: string }>
  installFromSource(source: string): Promise<{ ok: boolean; id?: string; error?: string }>
  installFromUrl(url: string): Promise<{ ok: boolean; id?: string; error?: string }>
}

// ---------------------------------------------------------------------------
// Agent task hand-off (host-owned — desktop has a chat surface, others may not)
// ---------------------------------------------------------------------------
/**
 * Hand a natural-language task to the agent by starting a fresh chat session
 * prefilled with `prompt` (and auto-submitting it). This lets product surfaces
 * delegate operator work — "install this plugin", "uninstall that plugin" — to
 * the agent instead of telling the user to open a terminal. The host owns
 * everything UI-specific (minting the session, bringing the chat view forward);
 * the settings panes just describe the task.
 *
 * Optional: hosts without a chat surface omit it, and the affordances that
 * depend on it hide themselves (same pattern as `bridge` / `userscripts`).
 */
export type StartAgentTask = (
  prompt: string,
  opts?: {
    /** Origin badge shown above the composer until the user edits. */
    sourceApp?: string
    /** Run the new task inside this isolated Hermes Profile. */
    profileId?: string
    /** Bind the new session to an isolated managed-Extension draft. */
    workspacePath?: string
  },
) => void | Promise<void | string>

// ---------------------------------------------------------------------------
// composed bundle
// ---------------------------------------------------------------------------
export interface OptionsCapabilities {
  bridge?: BridgeCapability
  userscripts?: UserScriptCapability
  startAgentTask?: StartAgentTask
  managedExtensions?: import("@amiba/managed-extensions/bridge").ManagedExtensionsBridge
}
