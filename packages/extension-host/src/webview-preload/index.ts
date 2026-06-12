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
 * Exposes `window.amiba` to the extension page so it can communicate with
 * the desktop host without needing nodeIntegration.
 *
 * This module runs with `contextIsolation: true`. All public API is exposed
 * via `contextBridge.exposeInMainWorld`.
 */

import { contextBridge, ipcRenderer } from "electron"

import type {
  ChatStartSessionPayload,
  WebViewHostAPI,
} from "@amiba/extension-api"
import { HOST_API_VERSION } from "../version"

// Side-effect import only: the `declare global { Window.amiba }`
// augmentation lives in @amiba/extension-api/src/webview.ts so
// extensions and the preload share one source of truth for the shape.

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
      `[amiba webview preload] Cannot extract extensionId from pathname: ${window.location.pathname}. ` +
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

const api: WebViewHostAPI = {
  get extensionId(): string {
    return extensionId
  },

  get language(): string {
    return initialLanguage
  },

  get theme(): "light" | "dark" {
    return initialTheme
  },

  apiVersion: HOST_API_VERSION,

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

  chat: {
    startSession(payload: ChatStartSessionPayload): Promise<boolean> {
      return ipcRenderer.invoke(
        "webview:chat-start-session",
        payload,
      ) as Promise<boolean>
    },
  },

  on(event, cb) {
    const channel =
      event === "language" ? "webview:language-changed" : "webview:theme-changed"
    const handler = (_e: unknown, value: string) => cb(value)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.off(channel, handler)
  },
}

contextBridge.exposeInMainWorld("amiba", api)
