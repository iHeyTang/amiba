/**
 * Typed accessors for the desktop renderer's `window.amiba` bridge.
 *
 * Why a cast here instead of `declare global { interface Window { amiba } }`:
 *   1. This package compiles standalone and can't see apps/desktop's ambient
 *      `Window.amiba` augmentation — that `.d.ts` is only in the desktop
 *      tsconfig, not in @amiba/extension-host's or @amiba/ui's.
 *   2. The extension WebView's `window.amiba` is a DIFFERENT, smaller surface
 *      (`WebViewHostAPI` from @amiba/extension-api), so a single project-wide
 *      global augmentation would conflict between the two contexts.
 *
 * Centralising the cast here means it lives in exactly one typed place instead
 * of being scattered as `window as unknown as {...}` across every call site —
 * so a rename or shape change is a one-line edit, and TS still checks every
 * consumer against `AmibaRendererBridge`.
 */
import type { ExtensionsBridge } from "../preload"

/**
 * The slice of the desktop renderer bridge that shared `@amiba/*` packages
 * (extension-host, ui) consume. Mirrors the relevant members of the desktop
 * app's full `AmibaBridgeApi` (apps/desktop/src/renderer/global.d.ts).
 */
export interface AmibaRendererBridge {
  extensions: ExtensionsBridge
  getWebviewPreloadPath(): Promise<string>
  /** Present only in the desktop build (absent in browser-extension / web). */
  workspaces?: { getPathForFile(file: File): string }
  /** Present only in the desktop build (absent in browser-extension / web). */
  voice?: {
    ensureMicrophoneAccess(): Promise<
      "granted" | "denied" | "restricted" | "not-determined" | "unknown"
    >
  }
}

/**
 * Access the desktop bridge, asserting it exists. Use from code that only runs
 * inside the desktop renderer (where the preload always injects `window.amiba`).
 */
export function desktopBridge(): AmibaRendererBridge {
  return (window as unknown as { amiba: AmibaRendererBridge }).amiba
}

/**
 * Access the desktop bridge defensively — returns `undefined` when `window.amiba`
 * is absent (e.g. the browser-extension / web builds of @amiba/ui). Use for
 * feature-detected, desktop-only capabilities.
 */
export function maybeDesktopBridge(): AmibaRendererBridge | undefined {
  return (window as unknown as { amiba?: AmibaRendererBridge }).amiba
}
