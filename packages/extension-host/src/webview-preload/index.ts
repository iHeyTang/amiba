/**
 * Webview bridge preload — bundled to `out/preload/webview-bridge.js` and
 * injected into every extension WebView.
 *
 * WebView URLs now use the local HTTP server:
 *   http://127.0.0.1:<port>/extensions/<extensionId>/dist/ui/sidebar/index.html
 *
 * The extensionId is extracted from `location.pathname` — no query parameter
 * needed. This is consistent with the URL shape produced by use-contributes.
 *
 * Exposes `window.hermes` to the extension page so it can communicate with
 * the desktop host without needing nodeIntegration.
 *
 * This module runs with `contextIsolation: true`. All public API is exposed
 * via `contextBridge.exposeInMainWorld`.
 */

import { contextBridge, ipcRenderer } from "electron"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    hermes: {
      readonly extensionId: string
      readonly language: string
      readonly theme: "light" | "dark"
      ipc: {
        invoke<T>(channel: string, args?: unknown): Promise<T>
      }
      settings: {
        get<T>(key: string, fallback: T): Promise<T>
        set(key: string, value: unknown): Promise<void>
      }
      shell: {
        /**
         * Open a URL in the user's default browser. Use for "install
         * docs" style links, OAuth flows, anywhere the extension wants
         * to bounce the user out to a real browser instead of trying
         * to navigate inside the webview.
         */
        openExternal(url: string): Promise<void>
      }
      on(event: "language" | "theme", cb: (value: string) => void): () => void
    }
  }
}

// ---------------------------------------------------------------------------
// Resolve extensionId from the webview URL
// ---------------------------------------------------------------------------

// URL shape: http://127.0.0.1:<port>/extensions/<extensionId>/dist/ui/...
// The extensionId is the path segment after "/extensions/".
function resolveExtensionId(): string {
  if (typeof window === "undefined") return "unknown"
  const m = window.location.pathname.match(/^\/extensions\/([^/]+)\//)
  if (!m) {
    throw new Error(
      `[hermes webview preload] Cannot extract extensionId from pathname: ${window.location.pathname}. ` +
      "Extension WebViews must be loaded via http://127.0.0.1:<port>/extensions/<extensionId>/..."
    )
  }
  return decodeURIComponent(m[1]!)
}

const extensionId: string = resolveExtensionId()

// ---------------------------------------------------------------------------
// Bootstrap: fetch initial state synchronously at preload time.
// We use ipcRenderer.sendSync to make this synchronous so the values are
// available before any script runs in the webview. Falls back gracefully.
// ---------------------------------------------------------------------------

let initialLanguage = "en"
let initialTheme: "light" | "dark" = "dark"

try {
  const state = ipcRenderer.sendSync("webview:get-state", extensionId) as
    | { language: string; theme: string }
    | null
  if (state) {
    initialLanguage = state.language ?? "en"
    initialTheme = state.theme === "light" ? "light" : "dark"
  }
} catch {
  // Not fatal; defaults are fine.
}

// ---------------------------------------------------------------------------
// Expose the bridge
// ---------------------------------------------------------------------------

contextBridge.exposeInMainWorld("hermes", {
  get extensionId(): string {
    return extensionId
  },

  get language(): string {
    return initialLanguage
  },

  get theme(): "light" | "dark" {
    return initialTheme
  },

  ipc: {
    invoke<T>(channel: string, args?: unknown): Promise<T> {
      return ipcRenderer.invoke("ext-invoke", { extensionId, channel, args }) as Promise<T>
    },
  },

  settings: {
    get<T>(key: string, fallback: T): Promise<T> {
      return ipcRenderer.invoke("ext-settings:get", { extensionId, key, fallback }) as Promise<T>
    },
    set(key: string, value: unknown): Promise<void> {
      return ipcRenderer.invoke("ext-settings:set", { extensionId, key, value }) as Promise<void>
    },
  },

  shell: {
    openExternal(url: string): Promise<void> {
      return ipcRenderer.invoke("webview:shell-open-external", url) as Promise<void>
    },
  },

  on(event: "language" | "theme", cb: (value: string) => void): () => void {
    const channel =
      event === "language" ? "webview:language-changed" : "webview:theme-changed"
    const handler = (_e: unknown, value: string) => cb(value)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },
})
