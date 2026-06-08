/**
 * Typed accessor for `window.hermes`. The interface (`WebViewHostAPI`)
 * is the single source of truth in `@hermes-x/extension-api`; we
 * declare the ambient `Window.hermes` binding locally so this
 * extension's TS code can read `window.hermes.<...>` without casts.
 */
import type { WebViewHostAPI } from "@hermes-x/extension-api"

declare global {
  interface Window {
    hermes: WebViewHostAPI
  }
}

export const hermes = window.hermes
