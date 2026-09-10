import type { McpDependencies, McpDependency, McpLease } from "./dependencies.js";

export type McpBindingState =
  | { state: "waiting" | "connecting" | "disposed" }
  | { state: "ready"; lease: McpLease }
  | { state: "error"; code: string };

/** A consumer's durable intent, reconstructed from its configuration on startup.
 * Provider reload and same-account credential replacement renew the lease.
 * Account changes never silently transfer the consumer's authorization.
 */
export class McpDependencyBinding {
  private snapshot: McpBindingState = { state: "waiting" };
  private listeners = new Set<() => void>();
  private lease?: McpLease;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private unsubscribe: () => void;
  private detachSignal: () => void;
  private disposal?: Promise<void>;

  constructor(
    private dependencies: McpDependencies,
    private request: McpDependency,
    signal?: AbortSignal,
  ) {
    this.unsubscribe = dependencies.subscribe(() => this.refresh());
    const abort = () => { void this.dispose().catch(() => undefined); };
    signal?.addEventListener("abort", abort, { once: true });
    this.detachSignal = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) abort();
    else this.refresh();
  }

  getState(): McpBindingState { return this.snapshot; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private publish(snapshot: McpBindingState) {
    this.snapshot = snapshot;
    // Observers cannot prevent teardown or recovery of other consumers.
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers own their presentation errors. */ }
    }
  }

  private refresh() {
    if (this.stopped) return;
    this.pending = this.pending.then(() => this.reconcile());
  }

  private async reconcile() {
    if (this.stopped || (this.lease && !this.lease.signal.aborted)) return;
    this.publish({ state: "connecting" });
    try {
      await this.lease?.release();
      this.lease = undefined;
      const lease = await this.dependencies.acquire(this.request);
      this.lease = lease;
      if (this.stopped) {
        await lease.release();
        this.lease = undefined;
        return;
      }
      this.request.identity ??= lease.identity;
      lease.signal.addEventListener("abort", this.onRevoked, { once: true });
      if (lease.signal.aborted) this.onRevoked();
      else this.publish({ state: "ready", lease });
    } catch (error) {
      if (this.stopped) return;
      const code = error instanceof Error ? error.message : "";
      if (code === "mcp_dependency_unavailable" || code === "mcp_connection_disabled") {
        this.publish({ state: "waiting" });
      } else if (code === "mcp_dependencies_disposed") {
        void this.dispose().catch(() => undefined);
      } else {
        this.publish({ state: "error", code: [
          "mcp_dependency_version_mismatch", "mcp_dependency_identity_mismatch",
          "mcp_sharing_not_supported", "mcp_dependency_start_failed",
          "mcp_dependency_stopping",
          "mcp_dependency_tools_unavailable",
        ].includes(code) ? code : "mcp_dependency_failed" });
      }
    }
  }

  private onRevoked = () => {
    if (this.stopped) return;
    this.publish({ state: "waiting" });
    this.refresh();
  };

  /** Explicit retry after a startup failure; no timer or unbounded retry loop. */
  async retry(): Promise<void> {
    this.refresh();
    await this.pending;
  }

  /** Required features await readiness; optional features render getState(). */
  waitForReady(signal?: AbortSignal): Promise<McpLease> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => { cleanup(); reject(new Error("mcp_dependency_wait_cancelled")); };
      const check = () => {
        const state = this.snapshot;
        if (state.state === "ready" && !state.lease.signal.aborted) {
          cleanup(); resolve(state.lease);
        } else if (state.state === "error" || state.state === "disposed") {
          cleanup(); reject(new Error(state.state === "error" ? state.code : "mcp_dependency_disposed"));
        }
      };
      const unsubscribe = this.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.stopped = true;
    this.unsubscribe();
    this.detachSignal();
    this.lease?.signal.removeEventListener("abort", this.onRevoked);
    this.publish({ state: "disposed" });
    this.listeners.clear();
    this.disposal = this.pending.then(async () => {
      await this.lease?.release();
      this.lease = undefined;
    }).catch((error) => {
      this.disposal = undefined;
      throw error;
    });
    return this.disposal;
  }
}
