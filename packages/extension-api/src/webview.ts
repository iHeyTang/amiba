/**
 * Formal type contract for the `window.hermes` global injected into
 * every extension WebView page by the host's webview-bridge preload.
 *
 * This is the single source of truth for the renderer-side extension
 * API. The webview-preload implementation in `@amiba/extension-host`
 * declares its exposed object against `WebViewHostAPI`; extensions
 * type-check their own UI code against the same interface via the
 * ambient `Window.hermes` augmentation at the bottom of this file.
 *
 * Capability namespacing convention:
 *   `hermes.<domain>.<method>` — flat domain buckets (`ipc`, `settings`,
 *   `shell`, `chat`). New host capabilities should pick the bucket that
 *   matches their domain rather than nest under an umbrella namespace.
 */

/**
 * Bidirectional channel to the extension's OWN main-side code (the
 * utilityProcess that loaded `entries.main`). The host routes the call
 * to whatever handler the extension registered via `host.ipc.expose`.
 *
 * NOT a path to the host application — see `chat`, `shell`, etc. for
 * those. Trying to call into a host-side channel here will surface as
 * "extension <id> has not exposed channel: <name>".
 */
export interface WebViewIpc {
  invoke<T>(channel: string, args?: unknown): Promise<T>
}

/**
 * Namespaced settings store scoped under `ext.<extensionId>.`. Reads
 * and writes are isolated per extension; extensions cannot read each
 * other's keys.
 */
export interface WebViewSettings {
  get<T>(key: string, fallback: T): Promise<T>
  set(key: string, value: unknown): Promise<void>
}

/**
 * System-shell helpers proxied through the host. The webview can't
 * call `window.open` directly because of the sandbox; this is the
 * sanctioned route.
 */
export interface WebViewShell {
  /**
   * Open a URL in the user's default browser. The host validates the
   * scheme is http(s) — `file://`, `javascript:`, etc. are rejected.
   */
  openExternal(url: string): Promise<void>
}

/**
 * Inbound payload for the chat surface. `text` is the user-facing
 * prompt (will appear in the composer); future fields can carry
 * attachments, a target mode (new vs. current session), etc.
 */
export interface ChatStartSessionPayload {
  text: string
}

/**
 * Drive the host's chat surface from inside an extension.
 *
 * Today this exposes one operation: `startSession`. Calling it queues
 * a prompt into the same pending-prompt slot the URL handler, Quick-
 * Ask, and the socket inbox use; the host flips its sidebar back to
 * the chat view (deselecting any extension activity) and the chat
 * surface drains + auto-submits the prompt as if the user had typed
 * and pressed Enter themselves.
 *
 * Returns true if the host accepted the payload, false on shape
 * rejection (empty text, malformed object).
 *
 * Intended for guided-onboarding flows where the extension wants the
 * assistant to take over (install a CLI, configure credentials, etc.)
 * rather than the user manually following docs.
 */
export interface WebViewChat {
  startSession(payload: ChatStartSessionPayload): Promise<boolean>
}

/**
 * Subscribe to host broadcasts. Returns an unsubscribe.
 *
 * Events:
 *   - `language` — current resolved language ("en" | "zh-CN"),
 *     re-emitted whenever the desktop UI's language changes.
 *   - `theme`    — current resolved theme ("light" | "dark"),
 *     re-emitted whenever the desktop UI's theme changes.
 */
export type WebViewEvent = "language" | "theme"

/**
 * The full `window.hermes` surface for an extension WebView. Imported
 * by `@amiba/extension-host`'s webview-bridge for the implementation
 * declarations and by extension authors as a type-only import.
 */
export interface WebViewHostAPI {
  /** Stable id of the extension hosting this webview. */
  readonly extensionId: string
  /** Resolved language ("en" | "zh-CN"). */
  readonly language: string
  /** Resolved theme ("light" | "dark"). */
  readonly theme: "light" | "dark"
  /** Host extension-API level this desktop implements (for graceful degradation). */
  readonly apiVersion: number

  ipc: WebViewIpc
  settings: WebViewSettings
  shell: WebViewShell
  chat: WebViewChat

  on(event: WebViewEvent, cb: (value: string) => void): () => void
}

// NOTE: extension authors that want an ambient `window.hermes` typed as
// WebViewHostAPI should declare it locally in their own `global.d.ts`
// (or equivalent) — see `extensions/knowledge-base/src/ui/shared/
// hermes-bridge.ts` for the pattern. We intentionally do NOT
// `declare global` here because the desktop renderer's own
// `window.hermes` is a different, larger surface (storage / workspaces
// / quickAsk / hermesRuntime / ...) and the two would conflict.
