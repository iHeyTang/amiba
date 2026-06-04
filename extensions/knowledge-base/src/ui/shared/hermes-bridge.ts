/**
 * Typed accessor for `window.hermes`. The interface
 * (`WebViewHostAPI`) is the single source of truth in
 * `@hermes-x/extension-api`; we only declare the ambient
 * `Window.hermes` binding locally so the extension's TS code can
 * read `window.hermes.chat.startSession(...)` etc. without casts.
 *
 * extension-api itself intentionally does NOT `declare global` so it
 * stays compatible with the desktop renderer's own (much larger)
 * `window.hermes` shape.
 */
import type { WebViewHostAPI } from "@hermes-x/extension-api"

declare global {
  interface Window {
    hermes: WebViewHostAPI
  }
}

export const hermes = window.hermes
