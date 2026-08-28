import type { Agent } from "@deepseek-ai/dsh-agent";
import { foldScheduleEvents, scheduleView } from "@deepseek-ai/dsh-schedule";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { AgentScheduleCreateInput, AgentScheduleView } from "./types.js";
import { randomUUID } from "node:crypto";

type JsonRecord = Record<string, unknown>;

function valueOrThrow<T>(value: unknown): T {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = value as { code?: unknown; message?: unknown };
    if (typeof error.code === "string") {
      throw new Error(
        typeof error.message === "string" ? error.message : error.code,
      );
    }
  }
  return value as T;
}

function sessionIdOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("session_not_live");
  }
  return value.trim();
}

/** Direct, deterministic management face over the official Agent-scoped tools. */
export class DshScheduleManager {
  private readonly resumed = new Map<
    string,
    { dispose(): Promise<void> }
  >();

  constructor(private readonly ctx: Context) {}

  private async liveAgent(sessionId: unknown): Promise<Agent> {
    const id = sessionIdOf(sessionId);
    const live = this.ctx.agents.get(id as never);
    if (live) return live;

    // A session can be held live by subscribers alone — an open chat panel —
    // with no live agent to carry the Schedule tools. Resume is only for
    // retired sessions (its prepare refuses a live one), and DSH has no
    // attach-an-agent-to-a-live-session entry point, so this state cannot run
    // a management mutation. Refuse it legibly rather than letting the
    // persistence layer's "cannot prepare session while it is live" surface.
    if (this.ctx.sessions.get(id as never) !== undefined) {
      throw new Error(
        `session "${id}" is open without a live agent; send it a message (or close it) before managing its schedules`,
      );
    }

    // The Schedule tools intentionally exist only on live root Agents. A UI
    // management call therefore resumes the persisted owner through DSH's
    // official Agent factory; Electron is not involved in feature lifecycle.
    const stale = this.resumed.get(id);
    if (stale) {
      this.resumed.delete(id);
      await stale.dispose();
    }
    const handle = await this.ctx.agents.resume({
      resumeSessionId: id as never,
    });
    this.resumed.set(id, handle);
    return handle.agent;
  }

  private async execute(
    agent: Agent,
    name: "schedule_create" | "schedule_list" | "schedule_delete",
    args: JsonRecord,
  ): Promise<unknown> {
    const definition = this.ctx.tools.get(name, agent);
    if (!definition) throw new Error(`schedule tool ${name} is unavailable`);

    const callId = `amiba:${name}:${randomUUID()}`;
    return definition.execute(args, {
      callId,
      rootCallId: callId,
      name,
      arguments: args,
      agent,
      signal: AbortSignal.timeout(30_000),
      token: Symbol(callId),
      deferContext: () => undefined,
      concludeTurn: () => undefined,
    } as unknown as ToolRunContext);
  }

  async list(sessionId: string): Promise<AgentScheduleView[]> {
    const id = sessionIdOf(sessionId);
    const session = this.ctx.sessions.get(id as never) as
      | { events: readonly unknown[]; header: { seedLength?: number } }
      | undefined;
    if (session) {
      // Listing is a pure read, and the session event log — not the agent —
      // owns schedule state. Folding the live log directly serves every live
      // session, including one held live by an open chat panel with no agent,
      // where the tool path could only fail.
      const folded = foldScheduleEvents(
        session.events as never,
        session.header.seedLength ?? 0,
      );
      const now = Date.now();
      return folded.active.map((record) => ({
        ...scheduleView(record, now),
        sessionId,
      }));
    }
    const value = valueOrThrow<Array<Omit<AgentScheduleView, "sessionId">>>(
      await this.execute(
        await this.liveAgent(sessionId),
        "schedule_list",
        {},
      ),
    );
    return value.map((item) => ({ ...item, sessionId }));
  }

  async create(
    sessionId: string,
    input: AgentScheduleCreateInput,
  ): Promise<AgentScheduleView> {
    const args: JsonRecord = {
      prompt: input.prompt,
      ...(input.afterSeconds === undefined
        ? {}
        : { after_seconds: input.afterSeconds }),
      ...(input.everySeconds === undefined
        ? {}
        : { every_seconds: input.everySeconds }),
      ...(input.at === undefined ? {} : { at: input.at }),
    };
    const value = valueOrThrow<Omit<AgentScheduleView, "sessionId">>(
      await this.execute(
        await this.liveAgent(sessionId),
        "schedule_create",
        args,
      ),
    );
    return { ...value, sessionId };
  }

  async remove(sessionId: string, id: string) {
    return valueOrThrow<{
      id: string;
      deleted: boolean;
      code?: "schedule_not_found";
    }>(
      await this.execute(await this.liveAgent(sessionId), "schedule_delete", {
        id,
      }),
    );
  }

  async dispose(): Promise<void> {
    const handles = [...this.resumed.values()];
    this.resumed.clear();
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}
