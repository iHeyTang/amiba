import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PluginStartupState {
  phase: "preparing" | "prompt" | "loading" | "safe" | "ready";
  count: number;
  deadline?: number;
  reason?: "interrupted" | "inspection-failed" | "failed";
}

/** Main-process gate: background consumers cannot start DSH ahead of the window. */
export class PluginStartupGate {
  state: PluginStartupState = { phase: "preparing", count: 0 };
  safe = false;
  private initialized?: Promise<void>;
  private release!: () => void;
  private readonly decision = new Promise<void>(resolve => { this.release = resolve; });
  private timer?: ReturnType<typeof setTimeout>;
  private writes = Promise.resolve();
  private completed = false;
  constructor(
    private readonly marker: string,
    private readonly inspect: () => Promise<number>,
    private readonly changed: (state: PluginStartupState) => void = () => {},
    private readonly delay = 3000,
  ) {}
  private publish(state: PluginStartupState) { this.state = state; this.changed({ ...state }); }
  private persist(pending: boolean) {
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.marker), { recursive: true });
      const temporary = `${this.marker}.tmp`;
      await writeFile(temporary, JSON.stringify({ pending, plugins: this.state.count }), { mode: 0o600 });
      await rename(temporary, this.marker);
    });
    return this.writes;
  }
  initialize(): Promise<void> {
    return this.initialized ??= (async () => {
      let interrupted = false;
      try { interrupted = JSON.parse(await readFile(this.marker, "utf8")).pending === true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") interrupted = true; }
      let count: number;
      try { count = await this.inspect(); }
      catch { this.safe = true; this.publish({ phase: "safe", count: 0, reason: "inspection-failed" }); this.release(); return; }
      if (!count) { this.publish({ phase: "ready", count: 0 }); this.release(); return; }
      if (interrupted) { this.safe = true; this.publish({ phase: "safe", count, reason: "interrupted" }); this.release(); return; }
      this.publish({ phase: "prompt", count });
    })();
  }
  async present(): Promise<PluginStartupState> {
    await this.initialize();
    if (this.state.phase === "prompt" && !this.timer) {
      this.publish({ ...this.state, deadline: Date.now() + this.delay });
      this.timer = setTimeout(() => { void this.choose("continue"); }, this.delay);
    }
    return { ...this.state };
  }
  async wait(): Promise<void> { await this.initialize(); await this.decision; }
  async choose(choice: "continue" | "safe"): Promise<void> {
    await this.initialize();
    if (this.completed) return;
    if (choice === "continue" && this.state.phase !== "prompt") return;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (choice === "safe") {
      this.safe = true;
      this.publish({ phase: "safe", count: this.state.count, reason: this.state.reason });
      this.release();
    } else {
      // Commit crash evidence BEFORE releasing the runtime, never after spawn.
      try { await this.persist(true); }
      catch { await this.choose("safe"); return; }
      if (!this.safe) this.publish({ phase: "loading", count: this.state.count });
      this.release();
    }
  }
  async ready(): Promise<void> {
    if (this.state.phase === "prompt" || this.state.phase === "preparing") return;
    this.completed = true;
    await this.persist(false);
    this.publish({ ...this.state, phase: this.safe ? "safe" : "ready", deadline: undefined });
  }
  async failed(): Promise<void> {
    if (!this.state.count || this.safe) return;
    this.completed = false;
    await this.persist(true);
    this.publish({ ...this.state, reason: "failed" });
  }
}
