import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
// Type-only: loads dsh-agent's `ctx.agents` module augmentation.
import type {} from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@amiba/dsh-plugin-notification-hub";

import { assertValidRule, missedRunAt, nextRunAt } from "./rules.js";
import type { DshCronStore } from "./store.js";
import type {
  CronTask,
  CronTaskCreateInput,
  CronTaskPatch,
  CronTaskView,
} from "./types.js";

/** Node's setTimeout ceiling; longer waits are split. */
const MAX_WAIT_MS = 2_147_000_000;
/** Re-arm at least this often so wall-clock drift cannot strand a fire. */
const REARM_CEILING_MS = 60 * 60 * 1000;

/**
 * The cron engine: durable task definitions, one process-local timer, and a
 * fresh agent session per fire.
 *
 * A fire is `ctx.agents.create` on a brand-new session followed by a
 * `followup` of the task's prompt — the same primitives the host uses for a
 * conversation, so the run IS an ordinary session (visible, resumable,
 * persisted). The handle is disposed once the agent goes idle; the session
 * retires normally with its transcript intact.
 *
 * Boundary stated rather than papered over: the timer lives in the DSH
 * process, so nothing fires while the app is closed. A task may opt into
 * `catchUp`, which runs at most ONE missed fire at startup.
 */
export class CronService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly running = new Set<string>();

  constructor(
    private readonly ctx: Context,
    private readonly store: DshCronStore,
    private readonly now: () => number = Date.now,
  ) {}

  async start(): Promise<void> {
    const tasks = await this.store.list();
    const startedAt = this.now();
    for (const task of tasks) {
      const missed = missedRunAt(task, startedAt);
      if (missed !== null) void this.fire(task.id);
    }
    await this.arm();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async list(): Promise<CronTaskView[]> {
    const now = this.now();
    return (await this.store.list()).map((task) => ({
      ...task,
      nextRunAt: nextRunAt(task, now),
    }));
  }

  async create(input: CronTaskCreateInput): Promise<CronTaskView> {
    const name = input.name.trim();
    const prompt = input.prompt.trim();
    if (!name) throw new Error("cron: a task name is required");
    if (!prompt) throw new Error("cron: a task prompt is required");
    assertValidRule(input.rule);
    const now = this.now();
    const task: CronTask = {
      id: `cron_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      name,
      prompt,
      rule: input.rule,
      enabled: true,
      catchUp: input.catchUp === true,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.mutate((tasks) => [...tasks, task]);
    await this.arm();
    return { ...task, nextRunAt: nextRunAt(task, now) };
  }

  async update(id: string, patch: CronTaskPatch): Promise<CronTaskView> {
    if (patch.rule) assertValidRule(patch.rule);
    const now = this.now();
    let updated: CronTask | undefined;
    await this.store.mutate((tasks) =>
      tasks.map((task) => {
        if (task.id !== id) return task;
        updated = {
          ...task,
          ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
          ...(patch.prompt === undefined ? {} : { prompt: patch.prompt.trim() }),
          ...(patch.rule === undefined ? {} : { rule: patch.rule }),
          ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
          ...(patch.catchUp === undefined ? {} : { catchUp: patch.catchUp }),
          updatedAt: now,
        };
        return updated;
      }),
    );
    if (!updated) throw new Error(`cron: unknown task "${id}"`);
    await this.arm();
    return { ...updated, nextRunAt: nextRunAt(updated, now) };
  }

  async removeTask(id: string): Promise<void> {
    await this.store.mutate((tasks) => tasks.filter((task) => task.id !== id));
    await this.arm();
  }

  /** Run one task immediately, outside its rule. */
  async runNow(id: string): Promise<CronTaskView> {
    const task = await this.fire(id);
    return { ...task, nextRunAt: nextRunAt(task, this.now()) };
  }

  /** (Re)aim the single timer at the earliest upcoming fire. */
  private async arm(): Promise<void> {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const now = this.now();
    const upcoming = (await this.store.list())
      .map((task) => nextRunAt(task, now))
      .filter((instant): instant is number => instant !== null);
    const wait =
      upcoming.length === 0
        ? REARM_CEILING_MS
        : Math.min(Math.max(0, Math.min(...upcoming) - now), REARM_CEILING_MS);
    this.timer = setTimeout(() => {
      void this.wake();
    }, Math.min(wait, MAX_WAIT_MS));
    // A stray timer must never hold the process open.
    this.timer.unref?.();
  }

  /** Re-read the wall clock and run everything due; then re-arm. */
  private async wake(): Promise<void> {
    if (this.disposed) return;
    const now = this.now();
    const due = (await this.store.list()).filter((task) => {
      const at = nextRunAt(task, now - 1);
      return at !== null && at <= now;
    });
    for (const task of due) {
      await this.fire(task.id).catch(() => undefined);
    }
    await this.arm();
  }

  /** Spawn the fresh session for one task and record the run. */
  private async fire(id: string): Promise<CronTask> {
    const task = (await this.store.list()).find((entry) => entry.id === id);
    if (!task) throw new Error(`cron: unknown task "${id}"`);
    if (this.running.has(id)) return task;
    this.running.add(id);
    try {
      const sessionId = `session-${randomUUID()}`;
      const handle = await this.ctx.agents.create({
        sessionId: SessionId(sessionId) as never,
      });
      handle.agent.followup(
        createUserMessage({
          content: [{ type: "text", text: task.prompt }],
          source: { kind: "user", rpcId: `cron:${task.id}:${randomUUID()}` },
        } as never) as never,
      );
      const ranAt = this.now();
      let recorded: CronTask = task;
      await this.store.mutate((tasks) =>
        tasks.map((entry) => {
          if (entry.id !== id) return entry;
          recorded = { ...entry, lastRunAt: ranAt, lastSessionId: sessionId };
          return recorded;
        }),
      );
      this.notify(recorded, sessionId);
      // Let the run finish, then retire the session normally. Never keep the
      // handle around indefinitely — a leaked live agent was exactly the
      // defect the schedule adapter's resume cache had.
      void handle.agent
        .whenIdle()
        .then(() => handle.dispose())
        .catch(() => handle.dispose().catch(() => undefined));
      return recorded;
    } finally {
      this.running.delete(id);
    }
  }

  private notify(task: CronTask, sessionId: string): void {
    // Optional seam, same guarded pattern as the schedule adapter's notifier.
    const hub = (
      this.ctx as Context & {
        amibaNotifications?: {
          post(input: { title: string; body?: string; sessionId?: string }): void;
        };
      }
    ).amibaNotifications;
    hub?.post({
      title: task.name,
      body: task.prompt.slice(0, 120),
      sessionId,
    });
  }
}
