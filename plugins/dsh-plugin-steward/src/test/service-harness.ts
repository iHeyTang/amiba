import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { vi } from "vitest";

import { StewardService } from "../service.js";
import { StewardStore } from "../store.js";

type Listener = (session: unknown, event: unknown) => unknown;

export function harness(options: { presetAvailable?: boolean; askNoticeDelayMs?: number } = {}) {
  const live = new Map<string, FakeAgent>();
  const persisted = new Map<string, { meta: Record<string, unknown>; events: Array<Record<string, unknown>> }>();
  const listeners: Listener[] = [];
  const disposed: string[] = [];
  const created: Array<{ sessionId: string; meta?: Record<string, unknown>; agentOptions?: Record<string, unknown> }> = [];
  const resumed: string[] = [];
  const resumeOptions: Array<Record<string, unknown> | undefined> = [];
  /** Optional Cordis services read via `ctx.reflect.get` (e.g. `agentDefaultModel`). */
  const reflectServices = new Map<string, unknown>();
  const setupCtxs = new Map<string, FakeAgentCtx>();

  type FakeAgentCtx = { tools: { guard: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn> }; effect: ReturnType<typeof vi.fn> };
  type FakeAgent = {
    id: string;
    followup: ReturnType<typeof vi.fn>;
    /** Mirrors the real `Agent.ctx`: the agent-scoped context setup composes. */
    ctx: FakeAgentCtx;
    session: { id: string; header: Record<string, unknown>; events: Array<Record<string, unknown>> };
  };

  const makeAgentCtx = (): FakeAgentCtx => ({
    tools: { guard: vi.fn(() => () => undefined), register: vi.fn(() => () => undefined) },
    effect: vi.fn((run: () => unknown) => { run(); return () => undefined; }),
  });
  const makeAgent = (id: string, events: Array<Record<string, unknown>> = [], agentCtx = makeAgentCtx()): FakeAgent => ({
    id,
    followup: vi.fn(),
    ctx: agentCtx,
    session: { id, header: { id }, events },
  });

  const ctx = {
    agents: {
      get: (id: string) => live.get(id),
      create: vi.fn(async (opts: { sessionId: string; meta?: Record<string, unknown>; agentOptions?: Record<string, unknown>; setup?: (c: unknown) => Promise<unknown> }) => {
        const agentCtx = makeAgentCtx();
        setupCtxs.set(opts.sessionId, agentCtx);
        if (opts.setup) await opts.setup(agentCtx);
        const agent = makeAgent(opts.sessionId, [], agentCtx);
        live.set(opts.sessionId, agent);
        persisted.set(opts.sessionId, { meta: { id: opts.sessionId, ...opts.meta }, events: agent.session.events });
        created.push({ sessionId: opts.sessionId, ...(opts.meta ? { meta: opts.meta } : {}), ...(opts.agentOptions ? { agentOptions: opts.agentOptions } : {}) });
        return { agent, dispose: vi.fn(async () => { disposed.push(opts.sessionId); }) };
      }),
      resume: vi.fn(async (opts: { resumeSessionId: string; agentOptions?: Record<string, unknown>; setup?: (c: unknown) => Promise<unknown> }) => {
        resumeOptions.push(opts.agentOptions);
        const stored = persisted.get(opts.resumeSessionId);
        if (!stored) throw new Error("session_not_found");
        const agentCtx = makeAgentCtx();
        setupCtxs.set(opts.resumeSessionId, agentCtx);
        if (opts.setup) await opts.setup(agentCtx);
        const agent = makeAgent(opts.resumeSessionId, stored.events, agentCtx);
        live.set(opts.resumeSessionId, agent);
        resumed.push(opts.resumeSessionId);
        return { agent, dispose: vi.fn(async () => { disposed.push(opts.resumeSessionId); }) };
      }),
    },
    agentPresets: {
      defaultId: "standard",
      mount: vi.fn(async (_c: unknown, id?: string) => {
        if (options.presetAvailable === false) throw new Error(`unknown preset ${id}`);
      }),
    },
    sessionPersistence: {
      inspect: vi.fn(async (id: string) => {
        const stored = persisted.get(id);
        if (!stored) throw new Error("session_not_found");
        return stored;
      }),
      readFrom: vi.fn(async (id: string, fromSeq: number) => {
        const stored = persisted.get(id);
        if (!stored) throw new Error("session_not_found");
        return { meta: stored.meta, events: stored.events.filter((e) => (e.seq as number) >= fromSeq) };
      }),
    },
    sessionQuery: {
      searchSessions: vi.fn(async (): Promise<{ items: Array<{ header: { id: string; cwd?: string } }> }> => ({ items: [] })),
      readTitle: vi.fn(async (id: string) => (persisted.has(id) ? { title: `title of ${id}` } : undefined)),
    },
    on: (name: string, callback: Listener) => {
      if (name === "session/event") listeners.push(callback);
      return () => undefined;
    },
    effect: (run: () => unknown) => { const cleanup = run(); return async () => { if (typeof cleanup === "function") await cleanup(); }; },
    logger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    reflect: { get: (name: string) => reflectServices.get(name) },
  };

  const store = new StewardStore(mkdtempSync(join(tmpdir(), "amiba-steward-")));
  const onStewardSetup = vi.fn();
  const service = new StewardService(ctx as never, store, {
    defaultCwd: "/default",
    presetId: "amiba-steward",
    onStewardSetup,
    now: () => 5_000,
    ...(options.askNoticeDelayMs === undefined ? {} : { askNoticeDelayMs: options.askNoticeDelayMs }),
  });
  /** Seed a persisted, cold session the service did not create. */
  const persist = (id: string, events: Array<Record<string, unknown>> = [], meta: Record<string, unknown> = {}) => {
    persisted.set(id, { meta: { id, cwd: "/cold", ...meta }, events });
  };
  /** Fire a session/event as the kernel would, using the live agent's event log. */
  const emit = (sessionId: string, event: Record<string, unknown>) => {
    const agent = live.get(sessionId)!;
    agent.session.events.push(event);
    for (const listener of listeners) void listener(agent.session, event);
  };
  return { ctx, store, service, live, persisted, created, resumed, resumeOptions, reflectServices, disposed, setupCtxs, onStewardSetup, makeAgent, persist, emit };
}
