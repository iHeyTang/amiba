import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import type { Context } from "@deepseek-ai/cordis";
// Type-only: loads dsh-agent's `ctx.agents` module augmentation.
import type {} from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type {} from "@amiba/dsh-plugin-notification-hub";

import { cronSessionOrigin } from "./session-origin.js";

import { assertValidRule, missedRunAt, nextRunAt } from "./rules.js";
import type { DshCronStore } from "./store.js";
import type {
  CronRun,
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
  /**
   * Wall-clock instant up to which fires have been accounted for. A fire is
   * due when the task's next instant strictly after this watermark (and after
   * its own last run / last edit) is at or before now. Anchoring on the last
   * check rather than on `now - 1` is what lets a timer that wakes a
   * millisecond late — every real timer does — still see the instant it was
   * armed for. Startup seeds it with the start time: fires missed while the
   * process was down are `catchUp`'s business, not this loop's.
   */
  private checkedAt: number | null = null;

  constructor(
    private readonly ctx: Context,
    private readonly store: DshCronStore,
    private readonly now: () => number = Date.now,
  ) {}

  private readonly sessionOrigins = new Map<string, boolean>();

  private async readSessionEvents(id: string) {
    const handle = await this.ctx.sessionPersistence.open(SessionId(id), "read");
    try {
      return (await handle.read()).events;
    } finally {
      await handle.close();
    }
  }

  /** Read-only classification: survives rule deletion and needs no migration. */
  async sessionIds(ids: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const id of new Set(ids)) {
      let origin = this.sessionOrigins.get(id);
      if (origin === undefined) {
        try {
          origin = cronSessionOrigin(await this.readSessionEvents(id));
          // Blank sessions and failed reads are retried when their history arrives.
          if (origin !== undefined) {
            if (this.sessionOrigins.size >= 10000) this.sessionOrigins.clear();
            this.sessionOrigins.set(id, origin);
          }
        } catch {
          continue;
        }
      }
      if (origin) result.push(id);
    }
    return result;
  }

  async start(): Promise<void> {
    const tasks = await this.store.list();
    const startedAt = this.now();
    this.checkedAt = startedAt;
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

  private readonly recoveredSessions = new Set<string>();

  /** Recover pre-history runs from their persisted first-message provenance. */
  async list(sessionIds: string[] = []): Promise<CronTaskView[]> {
    let tasks = await this.store.list();
    const recovered = new Map<string, CronRun[]>();
    const settled = new Set<string>();
    const recorded = new Map(
      tasks.flatMap((task) =>
        this.taskRuns(task).map((run) => [run.sessionId, run] as const),
      ),
    );
    if (this.ctx.sessionPersistence)
      for (const id of new Set(sessionIds)) {
        if (
          this.recoveredSessions.has(id) ||
          recorded.get(id)?.finishedAt !== undefined
        )
          continue;
        try {
          const events = await this.readSessionEvents(id);
          if (cronSessionOrigin(events) === undefined) continue;
          if (!cronSessionOrigin(events)) {
            this.recoveredSessions.add(id);
            continue;
          }
          const first = events.find((event) => event.type === "user/message")!;
          const rpcId = (first.data as { source: { rpcId: string } }).source
            .rpcId;
          const taskId = rpcId.split(":")[1]!;
          const task = tasks.find((entry) => entry.id === taskId);
          if (!task || typeof first.time !== "number") continue;
          const terminal = [...events]
            .reverse()
            .find((event) => event.type === "turn/end");
          const run: CronRun = {
            sessionId: id,
            startedAt: first.time,
            ...(typeof terminal?.time === "number"
              ? { finishedAt: terminal.time }
              : {}),
          };
          recovered.set(taskId, [...(recovered.get(taskId) ?? []), run]);
          if (run.finishedAt !== undefined) settled.add(id);
        } catch {
          /* Retry unavailable transcripts on the next refresh. */
        }
      }
    if (recovered.size)
      tasks = await this.store.mutate((current) =>
        current.map((task) => {
          const additions = recovered.get(task.id);
          if (!additions) return task;
          const runs = new Map(
            this.taskRuns(task).map((run) => [run.sessionId, run]),
          );
          for (const run of additions) {
            const existing = runs.get(run.sessionId);
            runs.set(
              run.sessionId,
              existing
                ? {
                    ...run,
                    ...existing,
                    finishedAt: existing.finishedAt ?? run.finishedAt,
                  }
                : run,
            );
          }
          return {
            ...task,
            runs: [...runs.values()].sort((a, b) => b.startedAt - a.startedAt),
          };
        }),
      );
    for (const id of settled) this.recoveredSessions.add(id);
    const now = this.now();
    return tasks.map((task) => ({
      ...task,
      runs: this.taskRuns(task),
      nextRunAt: nextRunAt(task, now),
    }));
  }

  private taskRuns(task: CronTask): CronRun[] {
    const runs = task.runs ?? [];
    if (
      !task.lastSessionId ||
      runs.some((run) => run.sessionId === task.lastSessionId)
    )
      return runs;
    return [
      {
        sessionId: task.lastSessionId,
        startedAt: task.lastRunAt ?? task.createdAt,
      },
      ...runs,
    ];
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
          ...(patch.prompt === undefined
            ? {}
            : { prompt: patch.prompt.trim() }),
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
    // First arm establishes the watermark: nothing before this instant is
    // this loop's to fire.
    this.checkedAt ??= now;
    const upcoming = (await this.store.list())
      .map((task) => nextRunAt(task, now))
      .filter((instant): instant is number => instant !== null);
    const wait =
      upcoming.length === 0
        ? REARM_CEILING_MS
        : Math.min(Math.max(0, Math.min(...upcoming) - now), REARM_CEILING_MS);
    this.timer = setTimeout(
      () => {
        void this.wake();
      },
      Math.min(wait, MAX_WAIT_MS),
    );
    // A stray timer must never hold the process open.
    this.timer.unref?.();
  }

  /** Re-read the wall clock and run everything due; then re-arm. */
  private async wake(): Promise<void> {
    if (this.disposed) return;
    const now = this.now();
    const since = this.checkedAt ?? now;
    this.checkedAt = now;
    const due = (await this.store.list()).filter((task) => {
      // A task edited or run after the last check measures from that point,
      // so a rule created past today's instant waits for tomorrow's.
      const from = Math.max(since, task.updatedAt, task.lastRunAt ?? 0);
      const at = nextRunAt(task, from);
      return at !== null && at <= now;
    });
    for (const task of due) {
      await this.fire(task.id).catch((error: unknown) => {
        this.warn(
          `task "${task.name}" (${task.id}) failed to fire: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
    await this.arm();
  }

  private warn(message: string): void {
    const logger = (
      this.ctx as { logger?: (name: string) => { warn(message: string): void } }
    ).logger;
    try {
      logger?.("amiba-cron").warn(message);
    } catch {
      // No logger on this context (unit harness); the run is still recorded.
    }
  }

  /**
   * The host's current default model, read the way messaging-core and the
   * steward do: `agentDefaultModel` is mounted by the host runtime but is
   * never in `inject` (no optional flag in this cordis), so a point-in-time
   * `reflect.get` — absent means "let the kernel pick".
   */
  private defaultAgentOptions():
    | { provider: string; model: string }
    | undefined {
    const service = (
      this.ctx as {
        reflect?: { get?(name: string): unknown };
      }
    ).reflect?.get?.("agentDefaultModel") as
      | { currentSelection?(): { provider: string; model: string } | undefined }
      | undefined;
    const selection = service?.currentSelection?.();
    return selection
      ? { provider: selection.provider, model: selection.model }
      : undefined;
  }

  /** Spawn one fresh session seeded with a user message; retire it on idle. */
  private async spawnSession(
    prompt: string,
    rpcTag: string,
    record: (id: string) => Promise<void>,
    finish: (id: string) => Promise<void>,
  ): Promise<string> {
    const sessionId = `session-${randomUUID()}`;
    const agentOptions = this.defaultAgentOptions();
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(sessionId) as never,
      // A cron run has no workspace of its own. Seed the user's home — the
      // same default the desktop host and the steward use — because a
      // session created without `cwd` fails its first turn: agent presets
      // reference `{{cwd}}` in prompt assembly.
      meta: { cwd: homedir() },
      ...(agentOptions ? { agentOptions } : {}),
    });
    try {
      // Persist the session link before dispatch: even a very fast run is discoverable.
      await record(sessionId);
    } catch (error) {
      await handle.dispose();
      throw error;
    }
    try {
      handle.agent.followup(
        createUserMessage({
          content: [{ type: "text", text: prompt }],
          source: { kind: "user", rpcId: `${rpcTag}:${randomUUID()}` },
        } as never) as never,
      );
    } catch (error) {
      try {
        await finish(sessionId);
      } finally {
        await handle.dispose();
      }
      throw error;
    }
    // Let the run finish, then retire the session normally. Never keep the
    // handle around indefinitely — a leaked live agent was exactly the
    // defect the schedule adapter's resume cache had.
    void handle.agent
      .whenIdle()
      .then(
        () => finish(sessionId),
        () => finish(sessionId),
      )
      .catch((error) =>
        this.warn(`cron: could not record completion: ${String(error)}`),
      )
      .finally(() => handle.dispose().catch(() => undefined));
    return sessionId;
  }

  /** Spawn the fresh session for one task and record the run. */
  private async fire(id: string): Promise<CronTask> {
    const task = (await this.store.list()).find((entry) => entry.id === id);
    if (!task) throw new Error(`cron: unknown task "${id}"`);
    if (this.running.has(id)) return task;
    this.running.add(id);
    try {
      let recorded: CronTask = task;
      const sessionId = await this.spawnSession(
        task.prompt,
        `cron:${task.id}`,
        async (id) => {
          const ranAt = this.now();
          await this.store.mutate((tasks) =>
            tasks.map((entry) => {
              if (entry.id !== task.id) return entry;
              recorded = {
                ...entry,
                lastRunAt: ranAt,
                lastSessionId: id,
                runs: [
                  { sessionId: id, startedAt: ranAt },
                  ...this.taskRuns(entry),
                ],
              };
              return recorded;
            }),
          );
        },
        async (id) => {
          const finishedAt = this.now();
          await this.store.mutate((tasks) =>
            tasks.map((entry) =>
              entry.id !== task.id
                ? entry
                : {
                    ...entry,
                    runs: this.taskRuns(entry).map((run) =>
                      run.sessionId === id ? { ...run, finishedAt } : run,
                    ),
                  },
            ),
          );
        },
      );
      this.notify(recorded, sessionId);
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
          post(input: {
            title: string;
            body?: string;
            sessionId?: string;
          }): void;
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
