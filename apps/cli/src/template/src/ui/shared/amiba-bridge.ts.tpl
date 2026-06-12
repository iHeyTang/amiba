/**
 * Typed accessor for `window.amiba`. The interface (`WebViewHostAPI`)
 * is the single source of truth in `@amiba/extension-api`; we
 * declare the ambient `Window.amiba` binding locally so this
 * extension's TS code can read `window.amiba.<...>` without casts.
 */
import type { WebViewHostAPI } from "@amiba/extension-api"

declare global {
  interface Window {
    amiba: WebViewHostAPI
  }
}

export const amiba = window.amiba
