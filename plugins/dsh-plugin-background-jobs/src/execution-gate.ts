import { AsyncLocalStorage } from "node:async_hooks";
/** Cross-call arbitration; the official tool classifier remains authoritative.
 * Nested dispatch shares its parent's lease. Detached jobs acquire a new lease. */
export class ExecutionGate {
  private inherited = new AsyncLocalStorage<object>();
  private owners = new Map<object, { readers: number; writer: boolean; queue: Array<() => void> }>();
  detached<T>(run: () => T): T { return this.inherited.run(undefined as never, run); }
  async run<T>(owner: object, parallel: boolean, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    if (this.inherited.getStore() === owner) return run();
    signal.throwIfAborted();
    let state = this.owners.get(owner);
    if (!state) { state = { readers: 0, writer: false, queue: [] }; this.owners.set(owner, state); }
    const current = state;
    const release = await new Promise<() => void>((resolve, reject) => {
      let granted = false;
      const pump = () => { for (const start of [...current.queue]) start(); };
      const cancel = () => {
        if (granted) return;
        current.queue = current.queue.filter(start => start !== acquire);
        signal.removeEventListener("abort", cancel);
        reject(signal.reason); pump();
        if (!current.readers && !current.writer && !current.queue.length) this.owners.delete(owner);
      };
      const acquire = () => {
        if (current.queue[0] !== acquire || current.writer || (!parallel && current.readers)) return;
        current.queue.shift(); granted = true; signal.removeEventListener("abort", cancel);
        if (parallel) current.readers++; else current.writer = true;
        resolve(() => {
          if (parallel) current.readers--; else current.writer = false;
          pump();
          if (!current.readers && !current.writer && !current.queue.length) this.owners.delete(owner);
        });
      };
      signal.addEventListener("abort", cancel, { once: true });
      current.queue.push(acquire); pump();
    });
    try { signal.throwIfAborted(); return await this.inherited.run(owner, run); }
    finally { release(); }
  }
}
