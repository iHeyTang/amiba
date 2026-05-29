/**
 * PlatformAdapter — runtime-independent capability surface consumed by shared
 * UI / business code. Each app (extension, desktop) provides its own
 * implementation at boot via `setPlatform()`.
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export interface StorageChange {
  oldValue?: unknown
  newValue?: unknown
}

export type StorageChangeMap = Record<string, StorageChange>

export interface StorageAdapter {
  get(keys?: string | string[]): Promise<Record<string, unknown>>
  set(patch: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  /**
   * Subscribe to storage changes. `keys = undefined` means all keys.
   * Returns an unsubscribe function.
   */
  watch(
    keys: string | string[] | undefined,
    listener: (changes: StorageChangeMap) => void
  ): () => void
}

export interface RuntimeAdapter {
  sendMessage<T = unknown>(message: unknown): Promise<T>
  onMessage(listener: (msg: unknown) => void): () => void
  getInstallId(): Promise<string>
}

export interface TabInfo {
  id: number
  url?: string
  title?: string
  active?: boolean
  windowId?: number
}

export interface TabsAdapter {
  query(filter: { active?: boolean; currentWindow?: boolean }): Promise<TabInfo[]>
  create(opts: { url: string; active?: boolean }): Promise<TabInfo>
  update(tabId: number, opts: { url?: string; active?: boolean }): Promise<TabInfo>
  remove(tabId: number | number[]): Promise<void>
}

export interface ScriptingAdapter {
  executeScript<R>(opts: { tabId: number; func: () => R }): Promise<R[]>
}

export interface BookmarksAdapter {
  search(query: string): Promise<Array<{ id: string; title: string; url?: string }>>
}

export interface HistoryAdapter {
  search(opts: { text: string; maxResults?: number }): Promise<
    Array<{ id: string; url?: string; title?: string; lastVisitTime?: number }>
  >
}

export interface WindowsAdapter {
  getCurrent(): Promise<{ id: number; focused: boolean }>
  create(opts: { url?: string; focused?: boolean }): Promise<{ id: number }>
}

export interface NotificationsAdapter {
  notify(opts: { title: string; body: string; iconUrl?: string }): Promise<void>
}

export interface ShellAdapter {
  openExternal(url: string): Promise<void>
}

/**
 * A workspace change event. Either the bound directory itself changed
 * (bind/unbind) or a file inside the bound directory changed.
 */
export type WorkspaceChange =
  | { kind: "bound"; path: string }
  | { kind: "unbound" }
  | { kind: "file"; event: "add" | "change" | "unlink"; path: string }

/**
 * Workspace binding — a single chat-session-scoped directory that gives
 * the agent file-system context. Desktop only; the extension surface
 * leaves this undefined.
 */
export interface WorkspaceAdapter {
  bind(path: string): Promise<void>
  unbind(): Promise<void>
  getCurrent(): Promise<string | null>
  onChange(cb: (change: WorkspaceChange) => void): () => void
}

export interface PlatformAdapter {
  kind: "extension" | "desktop"
  storage: StorageAdapter
  runtime: RuntimeAdapter
  tabs: TabsAdapter
  scripting: ScriptingAdapter
  bookmarks: BookmarksAdapter
  history: HistoryAdapter
  windows: WindowsAdapter
  notifications: NotificationsAdapter
  shell: ShellAdapter
  /** Desktop-only. The extension leaves this undefined. */
  workspaces?: WorkspaceAdapter
}

let current: PlatformAdapter | null = null

export function setPlatform(adapter: PlatformAdapter) {
  current = adapter
}

export function getPlatform(): PlatformAdapter {
  if (!current) throw new Error("PlatformAdapter not initialized — call setPlatform() at boot")
  return current
}

export function hasPlatform(): boolean {
  return current !== null
}
