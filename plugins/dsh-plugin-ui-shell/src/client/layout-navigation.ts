/** Root-owned navigation cancellation, matching the pinned official layout contract. */
export class LayoutNavigation {
  private pending = new AbortController();
  private disposed = false;

  beginNavigation(): AbortSignal {
    this.pending.abort();
    this.pending = new AbortController();
    if (this.disposed) this.pending.abort();
    return this.pending.signal;
  }

  /** A committed navigation invalidates earlier asynchronous work. */
  commit(): void {
    this.pending.abort();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.abort();
  }
}
