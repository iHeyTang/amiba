/**
 * Ownership bookkeeping for embedded browser tabs.
 *
 * Split out of `embedded-browser.ts` because it is the part that has to be
 * exercised without Electron: it decides WHICH tab a browser call acts on,
 * and that decision is the whole reason a background task's page used to
 * appear in the workbench the user happened to be looking at.
 *
 * Two lookup modes live here on purpose:
 *
 * - A call that names a session sees only that session's tabs. It never
 *   falls back to another session's tab, and it never adopts one either —
 *   otherwise a background task would still steer the visible workbench.
 * - A call with no session (the user clicking "open browser", or any host
 *   with a single global browser) keeps the original global "last active
 *   tab wins" behaviour.
 */

/** The slice of Electron's `WebContents` this index needs. */
export interface BrowserTabHandle {
  isDestroyed(): boolean;
}

export interface BrowserTabRecord {
  /** `${ownerWebContentsId}:${tabId}` — unique across renderer windows. */
  key: string;
  tabId: string;
  /** The chat session that owns the tab; absent for session-less tabs. */
  sessionId?: string;
  contents: BrowserTabHandle;
}

interface RegistrationWaiter<E> {
  sessionId?: string;
  resolve(entry: E): void;
}

export function browserTabKey(ownerId: number, tabId: string): string {
  return `${ownerId}:${tabId}`;
}

export class BrowserTabIndex<E extends BrowserTabRecord> {
  private readonly tabs = new Map<string, E>();
  private globalActiveKey: string | null = null;
  private readonly activeKeyBySession = new Map<string, string>();
  private readonly waiters = new Set<RegistrationWaiter<E>>();

  get size(): number {
    return this.tabs.size;
  }

  get(key: string): E | undefined {
    return this.tabs.get(key);
  }

  values(): IterableIterator<E> {
    return this.tabs.values();
  }

  /**
   * Record a freshly registered tab and wake whoever asked for one.
   *
   * `explicitlyActive` is the renderer saying "this tab is the one on
   * screen". A session's first tab becomes that session's active tab even
   * without it — a background session mounts its webview hidden, so it never
   * claims to be active, and its own calls must still find it.
   */
  add(entry: E, explicitlyActive: boolean): void {
    this.tabs.set(entry.key, entry);
    if (entry.sessionId) {
      const current = this.activeKeyBySession.get(entry.sessionId);
      if (explicitlyActive || !current || !this.isLive(current)) {
        this.activeKeyBySession.set(entry.sessionId, entry.key);
      }
    }
    if (explicitlyActive || !this.globalActiveKey) {
      this.globalActiveKey = entry.key;
    }
    for (const waiter of [...this.waiters]) {
      if (waiter.sessionId && waiter.sessionId !== entry.sessionId) continue;
      waiter.resolve(entry);
    }
  }

  /** Make `entry` the active tab — globally, and for its own session. */
  activate(entry: E): void {
    this.globalActiveKey = entry.key;
    if (entry.sessionId)
      this.activeKeyBySession.set(entry.sessionId, entry.key);
  }

  delete(key: string): void {
    const entry = this.tabs.get(key);
    this.tabs.delete(key);
    if (this.globalActiveKey === key) {
      this.globalActiveKey = this.firstLiveKey() ?? null;
    }
    if (
      entry?.sessionId &&
      this.activeKeyBySession.get(entry.sessionId) === key
    ) {
      const replacement = this.firstLiveKey(entry.sessionId);
      if (replacement)
        this.activeKeyBySession.set(entry.sessionId, replacement);
      else this.activeKeyBySession.delete(entry.sessionId);
    }
  }

  /**
   * The live tab a call should act on. A session-scoped lookup stays inside
   * that session; a session-less one keeps the global behaviour.
   */
  active(sessionId?: string): E | undefined {
    if (sessionId) {
      const key = this.activeKeyBySession.get(sessionId);
      const entry = key ? this.tabs.get(key) : undefined;
      if (entry && !entry.contents.isDestroyed()) return entry;
      const fallbackKey = this.firstLiveKey(sessionId);
      return fallbackKey ? this.tabs.get(fallbackKey) : undefined;
    }
    const entry = this.globalActiveKey
      ? this.tabs.get(this.globalActiveKey)
      : undefined;
    return entry && !entry.contents.isDestroyed() ? entry : undefined;
  }

  /**
   * Wait for the next tab registered for `sessionId` (any tab when it is
   * absent). Returns the unsubscribe the caller uses on timeout.
   */
  addRegistrationWaiter(
    sessionId: string | undefined,
    resolve: (entry: E) => void,
  ): () => void {
    const waiter: RegistrationWaiter<E> = { sessionId, resolve };
    this.waiters.add(waiter);
    return () => this.waiters.delete(waiter);
  }

  private isLive(key: string): boolean {
    const entry = this.tabs.get(key);
    return Boolean(entry && !entry.contents.isDestroyed());
  }

  private firstLiveKey(sessionId?: string): string | undefined {
    for (const entry of this.tabs.values()) {
      if (entry.contents.isDestroyed()) continue;
      if (sessionId && entry.sessionId !== sessionId) continue;
      return entry.key;
    }
    return undefined;
  }
}
