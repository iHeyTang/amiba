/**
 * HomeView capability interfaces. Each is optional; extension provides
 * the chrome.* implementations, desktop omits and the corresponding UI
 * section hides or falls back.
 */

export interface HomeShortcut {
  id: string
  title: string
  url: string
  favIconUrl?: string
  index: number
}

export interface HomeShortcutsController {
  ready: boolean
  items: HomeShortcut[]
  error: string | null
  add(input: { title: string; url: string }): Promise<void>
  remove(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
  reorder(fromIndex: number, toIndex: number): Promise<void>
  refresh(): Promise<void>
}

export interface HomeShortcutsCapability {
  /** React hook returning the shortcuts controller. Must be stable. */
  useController(): HomeShortcutsController
}

/**
 * Build a favicon URL for a given page URL. Extension impl uses Chrome's
 * built-in `_favicon/` service; desktop has no equivalent so we return
 * null and the UI falls back to a generic globe icon.
 */
export interface FaviconCapability {
  /** Build a favicon URL for a page URL at a target size. */
  resolve(url: string, size: number): string | null
}

export interface HomeCapabilities {
  shortcuts?: HomeShortcutsCapability
  favicon?: FaviconCapability
}
