/**
 * Typed accessor for `window.hermes` injected by the webview-bridge
 * preload. Mirrors the pattern in extensions/knowledge-base.
 */
import type { WebViewHostAPI } from "@hermes-x/extension-api"

declare global {
  interface Window {
    hermes: WebViewHostAPI
  }
}

export const hermes = window.hermes
