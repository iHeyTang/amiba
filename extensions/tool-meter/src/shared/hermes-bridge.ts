/**
 * Typed accessor for `window.hermes` injected by the webview-bridge
 * preload. Same shape as the token-meter extension — duplicated
 * intentionally because it's ~10 lines and depends on this
 * extension's namespace.
 */
import type { WebViewHostAPI } from "@hermes-x/extension-api"

declare global {
  interface Window {
    hermes: WebViewHostAPI
  }
}

export const hermes = window.hermes
