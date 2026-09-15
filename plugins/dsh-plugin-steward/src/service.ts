import { readSessionHistory } from "@amiba/dsh-plugin-session-features";
import { featureSeed, type ConversationCadence, type ConversationLifecycle } from "@amiba/dsh-plugin-session-features";
import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
// Type-only: loads the `ctx.agents` / `ctx.tools` augmentations.
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-tools";
import { agentPresetProjectionDefinition } from "@deepseek-ai/dsh-agent-presets";
import { boundContextSummary, createUserMessage } from "@deepseek-ai/dsh-llm";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";

import {
  ASK_USER_TOOL,
  completedTurns,
  type CompletedTurn,
  describeTurnEndReason,
  pendingAskUser,
} from "./reply-fold.js";
import type { StewardStore } from "./store.js";
import {
  STEWARD_SOURCE,
  type AdoptInput,
  type AdoptResult,
  type DispatchInput,
  type DispatchResult,
  type StewardState,
  type StewardTask,
  type TaskTurnView,
} from "./types.js";

export { STEWARD_SOURCE } from "./types.js";

/** Appended to every dispatched message so a managed session asks in text, not via the guarded tool. */
export const DISPATCH_FOOTER =
  "---\n（来自大管家）需要用户输入时，请直接用文字提出问题并结束本轮，不要调用提问工具。";

/**
 * Fixed title for the steward's own session. An explicit user-sourced rename
 * pins the title (stops auto-summarization) — see `pinStewardTitle`.
 */
export const STEWARD_TITLE = "大管家";

const ASK_USER_DENIED =
  "This session is managed by the steward: ask the user in plain text and end your turn instead.";

const SUMMARY_CHARS = 200;
const UNTITLED = "未命名任务";

/**
 * How long a managed session's `ask_user_question` must stay pending before
 * the steward tells the user to go answer it. The guard denies the call at
 * EXECUTION time, i.e. after the model's request was already appended as a
 * `tool/call` — so an immediate notice would report a question that never
 * reaches the user. Waiting one beat lets the denial's `tool/result` land and
 * cancel the notice.
 */
const ASK_NOTICE_DELAY_MS = 1_500;

export interface StewardServiceOptions {
  instanceId?: string;
  title?: () => string;
  isManagedElsewhere?: (sessionId: string) => boolean;
  allStewardSessionIds?: () => string[];
  defaultCwd: string;
  taskPreset?: string;
  basePreset?: string;
  onStewardSetup?: (agentCtx: Context) => void;
  now?: () => number;
  /** @see ASK_NOTICE_DELAY_MS */
  askNoticeDelayMs?: number;
}

// An intersection (not `extends`) so this file's narrower service-shaped
// views of `agentPresets` / `sessionPersistence` / `sessionQuery` /
// `sessionTitle` never have to structurally satisfy the real, much larger
// ambient types those DSH packages augment `Context` with (some carry
// private class fields, which makes any plain object literal type provably
// unable to `extends` them). `sessionTitle` in particular is kept as a local
// structural type — rather than a type-only import of
// `@deepseek-ai/dsh-session-title`'s `SessionTitleService` — for the same
// reason: importing the real service class here has previously triggered a
// TS2430 "interface incorrectly extends" error against this package's own
// whole-program `Context` merge.
type StewardRuntimeContext = Omit<Context, "agentPresets" | "sessionPersistence" | "sessionQuery" | "sessionTitle"> & {
  agentPresets: {
    readonly defaultId: string;
    mount(agentCtx: Context, id?: string): Promise<unknown>;
  };
  sessionPersistence: import("@deepseek-ai/dsh-session-persistence").SessionPersistence;
  sessionQuery: {
    searchSessions(request: { query: string; limit?: number }): Promise<{ items: ReadonlyArray<{ header: { id: string; cwd?: string } }> }>;
    readTitle(id: string): Promise<{ title: string } | undefined>;
  };
  sessionTitle: {
    /** Explicit user-sourced rename: pins the title and stops auto-summarization. */
    rename(session: Session, title: string): unknown;
  };
};

function summarize(text: string): string {
  const flat = text.replace(/\s+/gu, " ").trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS)}…` : flat;
}

/** The latest logged `session/title` event's text, folded locally (mirrors `completedTurns`'s style in `reply-fold.ts`). */
function lastSessionTitle(events: readonly SessionEvent[]): string | undefined {
  const rows = events as unknown as ReadonlyArray<{ type: string; data: Record<string, unknown> }>;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.type !== "session/title") continue;
    const title = row.data.title;
    return typeof title === "string" ? title : undefined;
  }
  return undefined;
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
  private readonly retiredStewards = new Set<{ agent: Agent; dispose(): Promise<void> }>();
  private readonly taskAgents = new Map<string, Promise<Agent>>();
  /** Per-task deferred "go answer the question" notices, keyed by task id. */
  private readonly askTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Serializes reconcile/report work so two events for one task never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly detachEvents: () => void;
  private readonly askGuards = new Map<Context, () => void>();

  constructor(
    ctx: Context,
    private readonly store: Pick<StewardStore, "read" | "mutate">,
    private readonly options: StewardServiceOptions,
  ) {
    this.ctx = ctx as unknown as StewardRuntimeContext;
    this.now = options.now ?? Date.now;
    this.log = ctx.logger(STEWARD_SOURCE) as typeof this.log;
    this.detachEvents = ctx.on("session/event", (session, event) => {
      void this.handleSessionEvent(session, event).catch((error) => {
        this.log.error(`steward: failed to handle a session event: ${String(error)}`);
      });
    });
  }

  async start(): Promise<void> {
    await this.ensureStewardAgent();
    await this.recover();
  }

  /**
   * Awaitable so the plugin's effect disposer can hold unload open until the
   * steward agent is really gone — a report still queued behind `dispose()`
   * would otherwise resurrect it (`ensureStewardAgent` now refuses once
   * disposed, which is the other half of that guarantee).
   */
  async dispose(graceful = false): Promise<void> {
    this.disposed = true;
    this.detachEvents();
    for (const timer of this.askTimers.values()) clearTimeout(timer);
    this.askTimers.clear();
    for (const dispose of this.askGuards.values()) dispose();
    this.askGuards.clear();
    const handle = this.stewardHandle;
    this.stewardHandle = null;
    const retired = [...this.retiredStewards];
    this.retiredStewards.clear();
    await Promise.allSettled(retired.map(async entry => { if (graceful) await entry.agent.whenIdle(); await entry.dispose(); }));
    try {
      if (graceful) await handle?.agent.whenIdle();
      await handle?.dispose();
    } catch {
      // Teardown is best-effort; the owner is unloading either way.
    }
  }

  // ── steward session ──────────────────────────────────────────────────

  async refreshTitle(): Promise<void> {
    if (this.stewardHandle) await this.pinStewardTitle(this.stewardHandle.agent);
  }

  async ensureStewardSessionId(): Promise<string> {
    return (await this.ensureStewardAgent()).id as string;
  }

  async stewardConversationIds(): Promise<string[]> {
    const lifecycle = this.ctx.reflect?.get?.("amibaConversations") as ConversationLifecycle | undefined;
    const state = await this.store.read();
    const history = lifecycle ? await lifecycle.history({ plugin: STEWARD_SOURCE, entry: this.options.instanceId ?? "main", scope: "owner" }) : [];
    return [...new Set([...history.map((segment) => segment.sessionId), ...(state.stewardSessionId ? [state.stewardSessionId] : [])])];
  }

  /** Settings reads never create or advance a conversation. */
  async conversationSettings(action: "status" | "configure" | "new", cadence?: ConversationCadence) {
    const lifecycle = this.ctx.reflect?.get?.("amibaConversations") as ConversationLifecycle | undefined;
    if (!lifecycle) throw new Error("conversation_owner_unavailable");
    const origin = { plugin: STEWARD_SOURCE, entry: this.options.instanceId ?? "main", scope: "owner" };
    if (action === "configure") {
      if (!cadence) throw new Error("conversation_cadence_required");
      await lifecycle.configureCadence(origin, cadence);
    } else if (action === "new") {
      await lifecycle.newConversation(origin);
    } else if (action !== "status") {
      throw new Error("invalid_conversation_action");
    }
    return lifecycle.view(origin);
  }

  /**
   * Pin the steward session's title to a fixed name so it never drifts to an
   * auto-generated summary. A no-op once the title is already correct — read
   * locally off the live session's own log (`lastSessionTitle`) rather than
   * round-tripping through the host, since `ensureStewardAgent` already has
   * the exact agent (and its events) in hand on every branch. Best-effort:
   * a rename failure is logged and swallowed so it can never block boot.
   */
  private async pinStewardTitle(agent: Agent): Promise<void> {
    try {
      if (lastSessionTitle(agent.session.snapshotEvents()) === (this.options.title?.() ?? STEWARD_TITLE)) return;
      this.ctx.sessionTitle.rename(agent.session, this.options.title?.() ?? STEWARD_TITLE);
    } catch (error) {
      this.log.warn(`steward: failed to pin the steward session title: ${String(error)}`);
    }
  }

  /**
   * Name a newly created task session after its task so it doesn't sit as
   * "未命名对话" forever: DSH's auto-title only folds HUMAN `user/message`s,
   * and every message the steward sends into a task session is
   * plugin-sourced (see `DISPATCH_FOOTER`'s call site below), so no title is
   * ever derived on its own. Renamed once, at creation, via the same
   * explicit-rename mechanism as `pinStewardTitle`; a later user rename in
   * the UI wins from then on since this is never called again for an
   * existing task. Only `dispatch()`'s `newTask` branch calls this —
   * adopted sessions already carry their own title and are deliberately
   * left alone. Best-effort: a failure is logged and swallowed so it can
   * never block dispatch.
   */
  private async pinNewTaskTitle(agent: Agent, task: StewardTask): Promise<void> {
    try {
      this.ctx.sessionTitle.rename(agent.session, task.title);
    } catch (error) {
      this.log.warn(`steward: failed to name the new task session ${task.sessionId}: ${String(error)}`);
    }
  }

  /** Called by the submit path, never by page polling, to advance the entry. */
  async prepareStewardSession(sessionId: string): Promise<string> {
    const lifecycle = this.ctx.reflect?.get?.("amibaConversations") as ConversationLifecycle | undefined;
    const state = await this.store.read();
    const origin = lifecycle ? await lifecycle.originForSession(sessionId) : undefined;
    if (sessionId !== state.stewardSessionId && !(origin?.plugin === STEWARD_SOURCE && origin.entry === (this.options.instanceId ?? "main") && origin.scope === "owner"))
      throw new Error("steward: session does not belong to this entry");
    return (await this.ensureStewardAgent(true)).id as string;
  }

  private retireSteward(handle: { agent: Agent; dispose(): Promise<void> }): void {
    this.retiredStewards.add(handle);
    // A rollover releases memory only after the old turn finishes; it never cancels it.
    void (async () => {
      await handle.agent.whenIdle();
      if (!this.retiredStewards.delete(handle)) return;
      await handle.dispose();
    })().catch((error) => this.log.warn(`steward: failed to release previous conversation: ${String(error)}`));
  }

  private ensureStewardAgent(advance = false): Promise<Agent> {
    // Never mint (or adopt) an agent after unload has begun: a report racing
    // `dispose()` would otherwise leave a live steward nobody owns.
    if (this.disposed) return Promise.reject(new Error("steward: disposed"));
    if (this.stewardPending) return this.stewardPending;
    const currentHandle = this.stewardHandle;
    if (currentHandle && !advance) return this.store.read().then(() => {
      if (this.disposed) throw new Error("steward: disposed");
      return currentHandle.agent;
    });
    this.stewardPending = (async () => {
      let state = await this.store.read();
      if (state.extensionVersion !== undefined && state.extensionVersion !== 1) throw new Error(`Unsupported steward extension version ${state.extensionVersion}`);
      let basePreset = state.basePreset ?? this.options.basePreset ?? this.ctx.agentPresets.defaultId;
      const setup = async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, basePreset);
        this.options.onStewardSetup?.(agentCtx);
      };
      const lifecycle = this.ctx.reflect?.get?.("amibaConversations") as ConversationLifecycle | undefined;
      if (lifecycle) {
        const origin = { plugin: STEWARD_SOURCE, entry: this.options.instanceId ?? "main", scope: "owner" };
        if (state.stewardSessionId && !await lifecycle.originForSession(state.stewardSessionId)) {
          try {
            const legacy = await readSessionHistory(this.ctx.sessionPersistence, state.stewardSessionId);
            const persistedPreset = resolveSessionPreset({ header: legacy.meta, events: legacy.events } as never);
            if (persistedPreset) basePreset = persistedPreset;
            await lifecycle.adopt(origin, state.stewardSessionId, legacy.meta.createdAt ?? legacy.events[0]?.time ?? this.now());
          } catch (error) {
            const missing = (error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.message === "session_not_found");
            if (!missing) throw error;
          }
        }
        let created: { agent: Agent; dispose(): Promise<void> } | undefined;
        const segment = await lifecycle.resolve(origin, {
          create: async () => {
            const sessionId = `session-${randomUUID()}`;
            created = await this.ctx.agents.create({
              sessionId: sessionId as never,
              meta: { cwd: this.options.defaultCwd, agentPreset: basePreset },
              seed: featureSeed(sessionId, STEWARD_SOURCE, 1),
              ...this.agentOptionsSpread(), setup,
            });
            return { sessionId, dispose: () => created!.dispose() };
          },
          isClosed: async (id) => {
            if (this.isArchived(id)) return true;
            if (this.ctx.agents.get(id as never)) return false;
            try { await readSessionHistory(this.ctx.sessionPersistence, id); return false; }
            catch (error) {
              if ((error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.message === "session_not_found")) return true;
              throw error;
            }
          },
        }, undefined, advance);
        try {
          state = await this.store.mutate((current) => ({ ...current, stewardSessionId: segment.sessionId, basePreset, extensionVersion: 1 }));
        } catch (error) {
          await created?.dispose();
          throw error;
        }
        if (this.disposed) { await created?.dispose(); throw new Error("steward: disposed"); }
        if (this.stewardHandle?.agent.id === segment.sessionId) return this.stewardHandle.agent;
        if (this.stewardHandle) this.retireSteward(this.stewardHandle);
        this.stewardHandle = null;
        if (created) {
          this.stewardHandle = created;
          await this.pinStewardTitle(created.agent);
          return created.agent;
        }
      }
      if (state.stewardSessionId) {
        const id = state.stewardSessionId;
        const live = this.ctx.agents.get(id as never) as Agent | undefined;
        if (live) {
          // Someone else (the UI, a resume elsewhere) already owns this agent,
          // so we hold no handle for it — but its scope still needs the
          // steward_* tools or the steward would sit there tool-less.
          this.options.onStewardSetup?.(live.ctx);
          this.stewardHandle = { agent: live, dispose: async () => undefined };
          await this.pinStewardTitle(live);
          return live;
        }
        // Only "the session can't be loaded at all" falls through to creating a
        // fresh one. A failure of `resume` itself (including a `setup` throw) is
        // never treated as "not loadable" — that would silently orphan the
        // user's steward history — so it propagates instead.
        let loadable = true;
        try {
          const inspected = await readSessionHistory(this.ctx.sessionPersistence, id);
          const persistedPreset = resolveSessionPreset({ header: inspected.meta, events: inspected.events } as never);
          if (persistedPreset) {
            basePreset = persistedPreset;
          }
        } catch (error) {
          const missing = (error as NodeJS.ErrnoException).code === "ENOENT" || (error instanceof Error && error.message === "session_not_found");
          if (!missing) throw error;
          loadable = false;
          this.log.warn(`steward: session ${id} is missing; creating a new one`);
        }
        if (loadable) {
          try {
            const handle = await this.ctx.agents.resume({ resumeSessionId: id as never, ...this.agentOptionsSpread(), setup });
            if (this.disposed) { await handle.dispose(); throw new Error("steward: disposed"); }
            this.stewardHandle = handle;
            await this.pinStewardTitle(handle.agent);
            return handle.agent;
          } catch (error) {
            this.log.error(`steward: failed to resume the steward session ${id}: ${String(error)}`);
            throw error;
          }
        }
      }
      const sessionId = `session-${randomUUID()}`;
      const handle = await this.ctx.agents.create({
        sessionId: sessionId as never,
        meta: { cwd: this.options.defaultCwd, agentPreset: basePreset },
        seed: featureSeed(sessionId, STEWARD_SOURCE, 1),
        ...this.agentOptionsSpread(),
        setup,
      });
      try {
        await this.store.mutate((current) => ({ ...current, stewardSessionId: sessionId, basePreset, extensionVersion: 1 }));
      } catch (error) {
        await handle.dispose();
        throw error;
      }
      if (this.disposed) { await handle.dispose(); throw new Error("steward: disposed"); }
      this.stewardHandle = handle;
      await this.pinStewardTitle(handle.agent);
      return handle.agent;
    })().finally(() => {
      this.stewardPending = null;
    });
    return this.stewardPending;
  }

  // ── tasks ────────────────────────────────────────────────────────────

  /**
   * Every task not owned by an archived session, closing any that just
   * became archived along the way. An archived session's task is dropped
   * from the result UNCONDITIONALLY — unlike an ordinary closed task, which
   * `includeDone` can still surface — because the client's group face polls
   * `listTasks(true)` to decide 「大管家」 membership (see
   * `client/index.tsx`'s `refreshAdopted`): once a session is archived it
   * must stop claiming that group, and dropping the row from every
   * `listTasks` call (rather than adding a new `archived` field the client
   * would need to learn) is what actually achieves that with the shape the
   * client already handles.
   */
  async listTasks(includeDone = false): Promise<StewardTask[]> {
    const { tasks } = await this.store.read();
    const active: StewardTask[] = [];
    for (const task of tasks) {
      if (this.isArchived(task.sessionId)) {
        if (task.status !== "done") await this.updateTask(task.id, { status: "done" });
        continue;
      }
      active.push(task);
    }
    return includeDone ? active : active.filter((task) => task.status !== "done");
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
    await this.store.read();
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
      await this.pinNewTaskTitle(agent, task);
      await this.store.mutate((state) => ({ ...state, tasks: [...state.tasks, task] }));
      created = true;
    } else {
      task = await this.findTask(input.taskId!);
      // An archived session is never resumed: the user archived it (Amiba's
      // "delete" is becoming a DSH archive), so the task it backed is over.
      // Close it with the same vocabulary `closeTask` uses and refuse the
      // dispatch instead of silently reviving a session the user put away —
      // the thrown message reaches the steward's own model as this tool
      // call's failure, so it dispatches a fresh task instead.
      if (this.isArchived(task.sessionId)) {
        await this.updateTask(task.id, { status: "done" });
        throw new Error(`steward: task "${task.id}" was closed because its session was archived; dispatch a new task instead`);
      }
      try {
        agent = await this.ensureTaskAgent(task);
      } catch (error) {
        await this.updateTask(task.id, { status: "failed", lastError: String(error) });
        throw error;
      }
    }
    // `running` lands BEFORE the followup: a turn that starts and ends inside
    // the same tick would otherwise have its `idle`/`failed` outcome stomped
    // back to `running` by this write.
    await this.updateTask(task.id, { status: "running", lastError: undefined });
    await this.store.read();
    if (this.disposed) throw new Error("steward: disposed");
    agent.followup(
      createUserMessage({
        content: [{ type: "text", text: `${message}\n\n${this.options.title ? DISPATCH_FOOTER.replace("大管家", this.options.title()) : DISPATCH_FOOTER}` }],
        source: { kind: "plugin", plugin: STEWARD_SOURCE, form: "relay" } as never,
      }),
    );
    return { taskId: task.id, sessionId: task.sessionId, created };
  }

  /**
   * The deployment's default model route, or undefined on hosts that never
   * mount `agentDefaultModel`. Read via `ctx.reflect.get` (a non-throwing,
   * point-in-time lookup) — the service is optional and not in `inject`, and
   * Cordis throws on a bare access to an un-injected property. Presets render
   * `{{model}}` from this route, so every create/resume must carry it.
   */
  private defaultAgentOptions(): { provider: string; model: string } | undefined {
    const service = (this.ctx as { reflect?: { get?(name: string): unknown } }).reflect?.get?.("agentDefaultModel") as
      | { currentSelection?(): { provider: string; model: string } | undefined }
      | undefined;
    const selection = service?.currentSelection?.();
    return selection ? { provider: selection.provider, model: selection.model } : undefined;
  }

  /** `{ agentOptions }` to spread into an `agents.create/resume` call, or nothing. */
  private agentOptionsSpread(): { agentOptions?: { provider: string; model: string } } {
    const agentOptions = this.defaultAgentOptions();
    return agentOptions ? { agentOptions } : {};
  }

  /**
   * The optional `ctx.workspaceRegistry` service (`@deepseek-ai/dsh-workspace`):
   * the DSH-wide, durable set of archived session ids. Read via
   * `ctx.reflect.get`, the same non-throwing, point-in-time lookup as
   * `defaultAgentOptions` above and for the same reason — the service is
   * mounted unconditionally by the DSH host runtime, but is never in
   * `inject` (see the comment on `index.ts`'s own `inject`), and this
   * plugin's own tests may still omit it.
   */
  private workspaceRegistry(): { readonly archivedSessionIds: readonly string[] } | undefined {
    const service = (this.ctx as { reflect?: { get?(name: string): unknown } }).reflect?.get?.("workspaceRegistry") as
      | { archivedSessionIds: readonly string[] }
      | undefined;
    return service;
  }

  /**
   * Whether DSH's registry-global archive set already contains this session.
   * Absence of the registry itself (see `workspaceRegistry` above) means
   * "nothing is archived" — never a reason to treat every task as archived.
   */
  private isArchived(sessionId: string): boolean {
    return this.workspaceRegistry()?.archivedSessionIds.includes(sessionId as never) ?? false;
  }

  private guardAskUser(agentCtx: Context): void {
    if (this.askGuards.has(agentCtx)) return;
    const dispose = agentCtx.tools.guard((execution) => !this.disposed && execution.name === ASK_USER_TOOL ? ASK_USER_DENIED : undefined);
    this.askGuards.set(agentCtx, dispose);
    agentCtx.effect(() => () => { this.askGuards.delete(agentCtx); }, "amiba-steward.ask-guard");
  }

  private async createTaskAgent(task: StewardTask): Promise<Agent> {
    const preset = this.options.taskPreset ?? this.ctx.agentPresets.defaultId;
    const handle = await this.ctx.agents.create({
      sessionId: task.sessionId as never,
      meta: { cwd: task.cwd, ...(preset ? { agentPreset: preset } : {}) },
      ...this.agentOptionsSpread(),
      setup: async (agentCtx: Context) => {
        await this.ctx.agentPresets.mount(agentCtx, preset);
        this.guardAskUser(agentCtx);
      },
    });
    return handle.agent;
  }

  private ensureTaskAgent(task: StewardTask): Promise<Agent> {
    const live = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
    if (live) { this.guardAskUser(live.ctx); return Promise.resolve(live); }
    const existing = this.taskAgents.get(task.sessionId);
    if (existing) return existing;
    const resume = (async () => {
      const inspected = await readSessionHistory(this.ctx.sessionPersistence, task.sessionId);
      const preset = resolveSessionPreset({ header: inspected.meta, events: inspected.events } as never);
      const handle = await this.ctx.agents.resume({
        resumeSessionId: task.sessionId as never,
        ...this.agentOptionsSpread(),
        setup: async (agentCtx: Context) => {
          await this.ctx.agentPresets.mount(agentCtx, preset);
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
    const stewardIds = new Set(this.options.allStewardSessionIds?.() ?? await this.stewardConversationIds());
    let sessionId = input.sessionId?.trim();
    if (!sessionId) {
      const query = input.titleQuery?.trim();
      if (!query) throw new Error("steward: adopt requires sessionId or titleQuery");
      const page = await this.ctx.sessionQuery.searchSessions({ query, limit: 5 });
      const hits = page.items.filter((item) => !stewardIds.has(item.header.id) && !this.options.isManagedElsewhere?.(item.header.id));
      if (hits.length !== 1) {
        const candidates = await Promise.all(
          hits.map(async (item) => ({ sessionId: item.header.id, title: (await this.ctx.sessionQuery.readTitle(item.header.id))?.title ?? UNTITLED })),
        );
        return { kind: "candidates", candidates };
      }
      sessionId = hits[0]!.header.id;
    }
    if (this.options.isManagedElsewhere?.(sessionId)) throw new Error("session_already_managed");
    const lifecycle = this.ctx.reflect?.get?.("amibaConversations") as ConversationLifecycle | undefined;
    const origin = await lifecycle?.originForSession(sessionId);
    if (origin?.plugin === STEWARD_SOURCE || stewardIds.has(sessionId)) throw new Error("steward: the steward's own session cannot be adopted");
    // `sessionQuery.searchSessions` (titleQuery path above) does not exclude
    // archived sessions, and an explicit `sessionId` can name one directly —
    // refuse up front instead of creating a task row the very next
    // `listTasks`/`dispatch` call would just close again.
    if (this.isArchived(sessionId)) throw new Error(`steward: session "${sessionId}" is archived and cannot be adopted`);
    const bound = state.tasks.find((task) => task.sessionId === sessionId);
    if (bound) return { kind: "adopted", task: bound, existing: true };
    const inspected = await readSessionHistory(this.ctx.sessionPersistence, sessionId);
    const title = input.title?.trim() || (await this.ctx.sessionQuery.readTitle(sessionId))?.title || UNTITLED;
    const finished = completedTurns(inspected.events, -1);
    const lastReportedSeq = finished.length ? finished[finished.length - 1]!.endSeq : -1;
    const task = this.newTaskRecord({
      title,
      sessionId,
      cwd: inspected.meta.cwd ?? this.options.defaultCwd,
      origin: "adopted",
      lastReportedSeq,
    });
    const live = this.ctx.agents.get(sessionId as never) as Agent | undefined;
    await this.store.mutate((current) => ({ ...current, tasks: [...current.tasks, task] }));
    if (live) this.guardAskUser(live.ctx);
    return { kind: "adopted", task, existing: false };
  }

  async readTask(taskId: string, turns = 3): Promise<TaskTurnView[]> {
    const task = await this.findTask(taskId);
    // Say so instead of quietly returning turns from a session the user put
    // away: close the task (same vocabulary as `closeTask`/`dispatch` above)
    // and refuse, rather than pretending it still has fresh content to read.
    if (this.isArchived(task.sessionId)) {
      if (task.status !== "done") await this.updateTask(task.id, { status: "done" });
      throw new Error(`steward: task "${taskId}" is closed — its session was archived`);
    }
    const live = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
    const events = live ? live.session.snapshotEvents() : (await readSessionHistory(this.ctx.sessionPersistence, task.sessionId)).events;
    return completedTurns(events, -1)
      .slice(-Math.max(1, turns))
      .map((turn) => ({ turn: turn.turn, user: turn.userText, assistant: turn.assistantText, endedAt: turn.endedAt, failed: turn.failed }));
  }

  async closeTask(taskId: string): Promise<StewardTask> {
    return this.updateTask(taskId, { status: "done" });
  }

  // ── reporting ────────────────────────────────────────────────────────

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async taskBySession(sessionId: string): Promise<StewardTask | undefined> {
    const state = await this.store.read();
    if (sessionId === state.stewardSessionId) return undefined;
    const task = state.tasks.find((row) => row.sessionId === sessionId && row.status !== "done");
    if (!task) return undefined;
    // A `turn/end`/`tool/call`/`tool/result` arriving for a now-archived
    // session must never revive the task it belongs to (flag needs_input,
    // reconcile a turn, ...) — close it in place and report nothing.
    if (this.isArchived(sessionId)) {
      await this.updateTask(task.id, { status: "done" });
      return undefined;
    }
    return task;
  }

  private async handleSessionEvent(session: Session, event: SessionEvent): Promise<void> {
    if (this.disposed) return;
    const row = event as unknown as { type: string; data: Record<string, unknown> };
    if (row.type !== "turn/end" && row.type !== "tool/call" && row.type !== "tool/result") return;
    // Enqueue immediately (before the async taskBySession lookup) so the queue
    // order matches event order even when two events for the same session are
    // emitted back-to-back; the lookup happens inside the queued callback.
    await this.enqueue(async () => {
      if (this.disposed) return;
      const task = await this.taskBySession(session.id as string);
      if (!task) return;
      if (row.type === "turn/end") {
        await this.reconcileTask(task.id, session.snapshotEvents());
        return;
      }
      if (row.type === "tool/call" && row.data.name === ASK_USER_TOOL) {
        const fresh = await this.findTask(task.id);
        if (fresh.status === "done") return;
        if (fresh.status === "needs_input") return;
        await this.updateTask(task.id, { status: "needs_input" });
        this.armAskNotice(task.id);
        return;
      }
      if (row.type === "tool/result") {
        const fresh = await this.findTask(task.id);
        if (fresh.status === "done") return;
        if (fresh.status === "needs_input" && pendingAskUser(session.snapshotEvents()) === null) {
          this.clearAskNotice(task.id);
          await this.updateTask(task.id, { status: "running" });
        }
      }
    });
  }

  private clearAskNotice(taskId: string): void {
    const timer = this.askTimers.get(taskId);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.askTimers.delete(taskId);
  }

  /**
   * Tell the user to go answer, but only once the question has survived a
   * beat: `tools.guard` denies `ask_user_question` at execution time, i.e.
   * after the model's request is already in the log, so the denial arrives as
   * a `tool/result` right behind the `tool/call` that armed this.
   */
  private armAskNotice(taskId: string): void {
    this.clearAskNotice(taskId);
    const timer = setTimeout(() => {
      this.askTimers.delete(taskId);
      void this.enqueue(async () => {
        if (this.disposed) return;
        const fresh = await this.findTask(taskId);
        if (fresh.status !== "needs_input") return;
        // Read the live log rather than the captured event array: it is the
        // only view guaranteed to include whatever landed during the delay.
        const live = this.ctx.agents.get(fresh.sessionId as never) as Agent | undefined;
        if (!live || pendingAskUser(live.session.snapshotEvents()) === null) {
          // The question was already answered (or denied) by the time this
          // fired — e.g. its tool/result raced ahead of the tool/call in the
          // queue — so the earlier needs_input never got rolled back. Heal it.
          await this.updateTask(taskId, { status: "running" });
          return;
        }
        await this.deliver(
          `【任务汇报】${fresh.title}（task: ${fresh.id}）\n状态：正在它的会话里等你回答一个问题（会话 ${fresh.sessionId}）。请切到那个会话作答。`,
          reportSummary(fresh.title, "需要你输入"),
        );
      }).catch((error) => {
        this.log.error(`steward: failed to relay a pending question for ${taskId}: ${String(error)}`);
      });
    }, this.options.askNoticeDelayMs ?? ASK_NOTICE_DELAY_MS);
    timer.unref?.();
    this.askTimers.set(taskId, timer);
  }

  /** Report every completed turn after `lastReportedSeq`, oldest first, then advance the cursor. */
  private async reconcileTask(taskId: string, events: readonly SessionEvent[]): Promise<void> {
    if (this.disposed) return;
    const task = await this.findTask(taskId);
    if (task.status === "done") return;
    // Reached directly from `recover()` at boot, which bypasses
    // `taskBySession`'s own archived check — guard here too so a task whose
    // session was archived while the runtime was down is closed instead of
    // reported on and revived.
    if (this.isArchived(task.sessionId)) {
      await this.updateTask(taskId, { status: "done" });
      return;
    }
    const turns = completedTurns(events, task.lastReportedSeq);
    for (const turn of turns) {
      await this.deliver(
        formatReport(task, turn),
        reportSummary(task.title, reportOutcome(turn)),
      );
      const reason = describeTurnEndReason(turn.reason);
      await this.updateTask(taskId, {
        lastReportedSeq: turn.endSeq,
        lastSummary: summarize(turn.assistantText),
        status: turn.failed ? "failed" : "idle",
        lastError: turn.failed ? reason : undefined,
      });
    }
    if (turns.length === 0 && task.status !== "needs_input" && pendingAskUser(events)) {
      await this.updateTask(taskId, { status: "needs_input" });
    }
  }

  /**
   * Put one report into the steward's own conversation.
   *
   * `notice`, never `relay`: nobody addressed a report TO the steward — it
   * is "a one-off account of something that just happened", which is exactly
   * DSH's `notice` form. The distinction is what the transcript reads: a
   * relay renders as a user turn (and a task report rendered that way looked
   * like something the person had typed, in flat text that hid its tables),
   * while a notice renders as a collapsed row keyed by `summary`. The model
   * still reads the full `text` — the kernel projects every `user/message`
   * into the request history verbatim, form and all — so the steward can
   * refer back to a report on a later turn exactly as before.
   *
   * @param text - the report the steward's model reads, unchanged.
   * @param summary - one line for the collapsed row, bounded to the kernel's
   *   `CONTEXT_SUMMARY_MAX_CHARS` (a task title has no length of its own).
   */
  private async deliver(text: string, summary: string): Promise<void> {
    const steward = await this.ensureStewardAgent();
    await this.store.read();
    if (this.disposed) return;
    steward.followup(
      createUserMessage({
        content: [{ type: "text", text }],
        source: {
          kind: "plugin",
          plugin: STEWARD_SOURCE,
          form: "notice",
          summary: boundContextSummary(summary),
        },
      }),
    );
  }

  /** Boot-time catch-up: turns that ended while the runtime was down. */
  private async recover(): Promise<void> {
    const { tasks } = await this.store.read();
    for (const task of tasks) {
      if (task.status === "done") continue;
      try {
        const live = this.ctx.agents.get(task.sessionId as never) as Agent | undefined;
        const events = live
          ? live.session.snapshotEvents()
          : (await readSessionHistory(this.ctx.sessionPersistence, task.sessionId, Math.max(0, task.lastReportedSeq + 1))).events;
        await this.enqueue(() => this.reconcileTask(task.id, events));
      } catch (error) {
        this.log.error(`steward: failed to recover task ${task.id}: ${String(error)}`);
      }
    }
  }

  /** Exposed for tests and the remote: current durable state. */
  async snapshot(): Promise<StewardState> {
    return this.store.read();
  }
}

/**
 * The one outcome word a report states, shared by the body and the collapsed
 * row so the two never drift into different vocabularies for one event.
 */
function reportOutcome(turn: CompletedTurn): string {
  return turn.failed ? `失败（${describeTurnEndReason(turn.reason)}）` : "完成";
}

/**
 * The one-line account that rides a delivered report's collapsed transcript
 * row. `deliver` bounds it; this only decides what it says.
 */
function reportSummary(title: string, outcome: string): string {
  return `任务汇报：${title} — ${outcome}`;
}

/**
 * Compact header (task id + outcome — the title already rides the delivered
 * notice's collapsed-row summary, so repeating it here would just be a second
 * copy of the same fact) then a blank line then the content, unchanged. No
 * `---` separator: the body is plain text for a quiet expanded row, not a
 * markdown document, and a bare `---` right under a line of text is a setext
 * heading underline to any markdown renderer that still sees this string.
 */
export function formatReport(task: StewardTask, turn: CompletedTurn): string {
  const body = turn.assistantText || "（这一轮没有文字回复）";
  return `task ${task.id} · ${reportOutcome(turn)}\n\n${body}`;
}

/** Replay the official preset projection so a post-creation selection survives resume. */
function resolveSessionPreset(session: { header: import("@deepseek-ai/dsh-session").SessionHeader; events: readonly SessionEvent[] }): string | undefined {
  return session.events.reduce(agentPresetProjectionDefinition.apply, agentPresetProjectionDefinition.init(session.header)) ?? undefined;
}
