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
// composed bundle
// ---------------------------------------------------------------------------
export interface OptionsCapabilities {
  bridge?: BridgeCapability
  userscripts?: UserScriptCapability
}
