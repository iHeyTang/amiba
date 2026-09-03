import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
// Type-only: loads the `ctx.agents` / `ctx.tools` augmentations.
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";

import { ASK_USER_TOOL, completedTurns, describeTurnEndReason, lastSeq, pendingAskUser } from "./reply-fold.js";
import type { StewardStore } from "./store.js";
import type {
  AdoptInput,
  AdoptResult,
  DispatchInput,
  DispatchResult,
  StewardState,
  StewardTask,
  TaskTurnView,
} from "./types.js";

export const STEWARD_SOURCE = "amiba-steward";

/** Appended to every dispatched message so a managed session asks in text, not via the guarded tool. */
export const DISPATCH_FOOTER =
  "---\n（来自大管家）需要用户输入时，请直接用文字提出问题并结束本轮，不要调用提问工具。";

const ASK_USER_DENIED =
  "This session is managed by the steward: ask the user in plain text and end your turn instead.";

const SUMMARY_CHARS = 200;
const UNTITLED = "未命名任务";

export interface StewardServiceOptions {
  defaultCwd: string;
  taskPreset?: string;
  presetId: string;
  onStewardSetup?: (agentCtx: Context) => void;
  now?: () => number;
}

interface StewardRuntimeContext extends Context {
  agentPresets: {
    readonly defaultId: string;
    mount(agentCtx: Context, id?: string): Promise<unknown>;
  };
  sessionPersistence: {
    inspect(id: string): Promise<{ meta: { cwd?: string; agentPreset?: string }; events: readonly SessionEvent[] }>;
    readFrom(id: string, fromSeq: number): Promise<{ events: readonly SessionEvent[] }>;
  };
  sessionQuery: {
    searchSessions(request: { query: string; limit?: number }): Promise<{ items: ReadonlyArray<{ header: { id: string; cwd?: string } }> }>;
    readTitle(id: string): Promise<{ title: string } | undefined>;
  };
}

function presetForSession(session: { meta: { agentPreset?: string }; events: readonly SessionEvent[] }): string | undefined {
  let preset = session.meta.agentPreset;
  for (const event of session.events) {
    const row = event as unknown as { type: string; data: Record<string, unknown> };
    if (row.type !== "agent-preset/selected") continue;
    const value = row.data.agentPreset;
    if (typeof value === "string" && value.trim()) preset = value.trim();
  }
  return preset;
}

function summarize(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS)}…` : flat;
}

/**
 * The steward engine. One always-live steward agent (its preset carries the
 * persona and ask-user; `onStewardSetup` registers the steward_* tools into
 * its scope), a durable task table, and the dispatch/report loop over
 * ordinary, user-visible task sessions.
 */
export class StewardService {
  private readonly ctx: StewardRuntimeContext;
  private readonly now: () => number;
  private readonly log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
  private stewardHandle: { agent: Agent; dispose(): Promise<void> } | null = null;
  private stewardPending: Promise<Agent> | null = null;
  private readonly taskAgents = new Map<string, Promise<Agent>>();
  /** Serializes reconcile/report work so two events for one task never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(
    ctx: Context,
    private readonly store: StewardStore,
    private readonly options: StewardServiceOptions,
  ) {
    this.ctx = ctx as StewardRuntimeContext;
    this.now = options.now ?? Date.now;
    this.log = ctx.logger(STEWARD_SOURCE) as typeof this.log;
    ctx.on("session/event", (session, event) => {
      void this.handleSessionEvent(session, event).catch((error) => {
        this.log.error(`steward: failed to handle a session event: ${String(error)}`);
      });
    });
  }

  async start(): Promise<void> {
    await this.ensureStewardAgent();
    await this.recover();
  }

  dispose(): void {
    this.disposed = true;
    const handle = this.stewardHandle;
    this.stewardHandle = null;
    void handle?.dispose().catch(() => undefined);
  }

  // ── steward session ──────────────────────────────────────────────────

  async ensureStewardSessionId(): Promise<string> {
    return (await this.ensureStewardAgent()).id as string;
  }

  private ensureStewardAgent(): Promise<Agent> {
    if (this.stewardHandle) return Promise.resolve(this.stewardHandle.agent);
    if (this.stewardPending) return this.stewardPending;
    this.stewardPending = (async () => {
      const state = await this.store.read();
      const setup = async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, this.options.presetId);
        this.options.onStewardSetup?.(agentCtx);
      };
      if (state.stewardSessionId) {
        const id = state.stewardSessionId;
        const live = this.ctx.agents.get(id as never) as Agent | undefined;
        if (live) {
          this.stewardHandle = { agent: live, dispose: async () => undefined };
          return live;
        }
        try {
          await this.ctx.sessionPersistence.inspect(id);
          const handle = await this.ctx.agents.resume({ resumeSessionId: id as never, setup });
          this.stewardHandle = handle;
          return handle.agent;
        } catch (error) {
          this.log.warn(`steward: session ${id} is not loadable (${String(error)}); creating a new one`);
        }
      }
      const sessionId = `session-${randomUUID()}`;
      const handle = await this.ctx.agents.create({
        sessionId: sessionId as never,
        meta: { cwd: this.options.defaultCwd, agentPreset: this.options.presetId },
        setup,
      });
      await this.store.mutate((current) => ({ ...current, stewardSessionId: sessionId }));
      this.stewardHandle = handle;
      return handle.agent;
    })().finally(() => {
      this.stewardPending = null;
    });
    return this.stewardPending;
  }

  // ── tasks ────────────────────────────────────────────────────────────

  async listTasks(includeDone = false): Promise<StewardTask[]> {
    const { tasks } = await this.store.read();
    return includeDone ? tasks : tasks.filter((task) => task.status !== "done");
  }

  private async updateTask(taskId: string, patch: Partial<StewardTask>): Promise<StewardTask> {
    let updated: StewardTask | undefined;
    await this.store.mutate((state) => ({
      ...state,
      tasks: state.tasks.map((task) => {
        if (task.id !== taskId) return task;
        updated = { ...task, ...patch, updatedAt: this.now() };
        return updated;
      }),
    }));
    if (!updated) throw new Error(`steward: unknown task "${taskId}"`);
    return updated;
  }

  private async findTask(taskId: string): Promise<StewardTask> {
    const task = (await this.store.read()).tasks.find((row) => row.id === taskId);
    if (!task) throw new Error(`steward: unknown task "${taskId}"`);
    return task;
  }

  private newTaskRecord(input: { title: string; sessionId: string; cwd: string; origin: StewardTask["origin"]; lastReportedSeq: number }): StewardTask {
    const now = this.now();
    return {
      id: `task-${randomUUID()}`,
      title: input.title,
      sessionId: input.sessionId,
      cwd: input.cwd,
      origin: input.origin,
      status: "idle",
      lastReportedSeq: input.lastReportedSeq,
      createdAt: now,
      updatedAt: now,
    };
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const message = input.message?.trim();
    if (!message) throw new Error("steward: dispatch requires a non-empty message");
    if (Boolean(input.taskId) === Boolean(input.newTask)) {
      throw new Error("steward: dispatch requires exactly one of taskId or newTask");
    }
    let task: StewardTask;
    let created = false;
    let agent: Agent;
    if (input.newTask) {
      const title = input.newTask.title?.trim();
      if (!title) throw new Error("steward: a new task needs a title");
      const cwd = input.newTask.cwd?.trim() || this.options.defaultCwd;
      const sessionId = `session-${randomUUID()}`;
      task = this.newTaskRecord({ title, sessionId, cwd, origin: "created", lastReportedSeq: -1 });
      agent = await this.createTaskAgent(task);
      await this.store.mutate((state) => ({ ...state, tasks: [...state.tasks, task] }));
      created = true;
    } else {
      task = await this.findTask(input.taskId!);
      try {
        agent = await this.ensureTaskAgent(task);
      } catch (error) {
        await this.updateTask(task.id, { status: "failed", lastError: String(error) });
        throw error;
      }
    }
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: `${message}\n\n${DISPATCH_FOOTER}` }],
        source: { kind: "plugin", plugin: STEWARD_SOURCE, form: "relay" },
      } as never) as never,
    );
    await this.updateTask(task.id, { status: "running", lastError: undefined });
    return { taskId: task.id, sessionId: task.sessionId, created };
  }

  private guardAskUser(agentCtx: Context): void {
    try {
      agentCtx.tools.guard((execution) => (execution.name === ASK_USER_TOOL ? ASK_USER_DENIED : undefined));
    } catch (error) {
      this.log.warn(`steward: could not guard ${ASK_USER_TOOL}: ${String(error)}`);
    }
  }

  private async createTaskAgent(task: StewardTask): Promise<Agent> {
    const preset = this.options.taskPreset;
    const handle = await this.ctx.agents.create({
      sessionId: task.sessionId as never,
      meta: { cwd: task.cwd, ...(preset ? { agentPreset: preset } : {}) },
      setup: async (agentCtx: Context) => {
        try {
          await this.ctx.agentPresets.mount(agentCtx, preset);
        } catch (error) {
          this.log.warn(`steward: could not mount preset "${String(preset)}" for ${task.sessionId}: ${String(error)}`);
        }
        this.guardAskUser(agentCtx);
      },
    });
    return handle.agent;
  }

  private ensureTaskAgent(task: StewardTask): Promise<Agent> {
    const live = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
    if (live) return Promise.resolve(live);
    const existing = this.taskAgents.get(task.sessionId);
    if (existing) return existing;
    const resume = (async () => {
      const inspected = await this.ctx.sessionPersistence.inspect(task.sessionId);
      const preset = presetForSession(inspected);
      const handle = await this.ctx.agents.resume({
        resumeSessionId: task.sessionId as never,
        setup: async (agentCtx: Context) => {
          try {
            await this.ctx.agentPresets.mount(agentCtx, preset);
          } catch (error) {
            this.log.warn(`steward: could not mount preset "${String(preset)}" while resuming ${task.sessionId}: ${String(error)}`);
          }
          this.guardAskUser(agentCtx);
        },
      });
      return handle.agent;
    })()
      .catch((error) => {
        const raced = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
        if (raced) return raced;
        throw error;
      })
      .finally(() => {
        this.taskAgents.delete(task.sessionId);
      });
    this.taskAgents.set(task.sessionId, resume);
    return resume;
  }

  async adopt(input: AdoptInput): Promise<AdoptResult> {
    const state = await this.store.read();
    let sessionId = input.sessionId?.trim();
    if (!sessionId) {
      const query = input.titleQuery?.trim();
      if (!query) throw new Error("steward: adopt requires sessionId or titleQuery");
      const page = await this.ctx.sessionQuery.searchSessions({ query, limit: 5 });
      const hits = page.items.filter((item) => item.header.id !== state.stewardSessionId);
      if (hits.length !== 1) {
        const candidates = await Promise.all(
          hits.map(async (item) => ({ sessionId: item.header.id, title: (await this.ctx.sessionQuery.readTitle(item.header.id))?.title ?? UNTITLED })),
        );
        return { kind: "candidates", candidates };
      }
      sessionId = hits[0]!.header.id;
    }
    const bound = state.tasks.find((task) => task.sessionId === sessionId);
    if (bound) return { kind: "adopted", task: bound, existing: true };
    const inspected = await this.ctx.sessionPersistence.inspect(sessionId);
    const title = input.title?.trim() || (await this.ctx.sessionQuery.readTitle(sessionId))?.title || UNTITLED;
    const task = this.newTaskRecord({
      title,
      sessionId,
      cwd: inspected.meta.cwd ?? this.options.defaultCwd,
      origin: "adopted",
      lastReportedSeq: lastSeq(inspected.events),
    });
    await this.store.mutate((current) => ({ ...current, tasks: [...current.tasks, task] }));
    return { kind: "adopted", task, existing: false };
  }

  async readTask(taskId: string, turns = 3): Promise<TaskTurnView[]> {
    const task = await this.findTask(taskId);
    const live = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
    const events = live ? live.session.events : (await this.ctx.sessionPersistence.inspect(task.sessionId)).events;
    return completedTurns(events, -1)
      .slice(-Math.max(1, turns))
      .map((turn) => ({ turn: turn.turn, user: turn.userText, assistant: turn.assistantText, endedAt: turn.endedAt, failed: turn.failed }));
  }

  async closeTask(taskId: string): Promise<StewardTask> {
    return this.updateTask(taskId, { status: "done" });
  }

  // ── reporting (Task 6) ───────────────────────────────────────────────

  private async handleSessionEvent(_session: Session, _event: SessionEvent): Promise<void> {}

  private async recover(): Promise<void> {}

  /** Exposed for tests and the remote: current durable state. */
  async snapshot(): Promise<StewardState> {
    return this.store.read();
  }
}
