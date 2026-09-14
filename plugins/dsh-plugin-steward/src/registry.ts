import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import { StewardService, type StewardServiceOptions } from "./service.js";
import {
  StewardRegistryStore,
  type StewardProfileInput,
} from "./registry-store.js";
import { STEWARD_SOURCE } from "./types.js";

/** Instances own durable identity; engines only own currently loaded agents. */
export class StewardRegistryService {
  private readonly engines = new Map<string, StewardService>();
  private ready?: Promise<void>;
  private readonly cleanups = new Set<Promise<void>>();
  constructor(
    private readonly ctx: Context,
    readonly store: StewardRegistryStore,
    private readonly options: StewardServiceOptions,
  ) {}
  initialize(): Promise<void> {
    return (this.ready ??= (async () => {
      await this.store.mutate((state) => state); // Persist first-use or v1 migration, including an explicitly empty registry.
      for (const item of (await this.store.read()).instances) {
        const history = await this.ctx.amibaConversations.history({
          plugin: STEWARD_SOURCE,
          entry: item.id,
          scope: "owner",
        });
        await this.store.mutate((state) => {
          const instance = state.instances.find((row) => row.id === item.id)!;
          instance.sessionIds = [
            ...new Set([
              ...instance.sessionIds,
              ...history.map((row) => row.sessionId),
            ]),
          ];
          return state;
        });
      }
    })());
  }
  async start() {
    await this.initialize();
    const results = await Promise.allSettled(
      (await this.list()).map((item) => this.engine(item.id).start()),
    );
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length)
      throw new AggregateError(
        failures,
        "Some steward instances could not resume",
      );
  }
  engine(id: string): StewardService {
    this.profile(id);
    let engine = this.engines.get(id);
    if (!engine) {
      engine = new StewardService(this.ctx, this.store.scoped(id), {
        ...this.options,
        instanceId: id,
        title: () => this.profile(id).name,
        isManagedElsewhere: (sessionId) =>
          this.store
            .snapshot()
            .instances.some(
              (item) =>
                item.id !== id &&
                item.state.tasks.some((task) => task.sessionId === sessionId),
            ),
        allStewardSessionIds: () =>
          this.store.snapshot().instances.flatMap((row) => row.sessionIds),
      });
      this.engines.set(id, engine);
    }
    return engine;
  }
  profile(id: string) {
    const item = this.store.snapshot().instances.find((row) => row.id === id);
    if (!item) throw new Error("steward_deleted_or_unknown");
    return item;
  }
  async forSession(sessionId: string): Promise<StewardService> {
    await this.initialize();
    const origin =
      await this.ctx.amibaConversations.originForSession(sessionId);
    const item = this.store
      .snapshot()
      .instances.find(
        (row) =>
          row.sessionIds.includes(sessionId) ||
          (origin?.plugin === STEWARD_SOURCE &&
            origin.scope === "owner" &&
            origin.entry === row.id),
      );
    if (!item) throw new Error("steward_session_not_owned");
    return this.engine(item.id);
  }
  async list() {
    await this.initialize();
    return (await this.store.read()).instances;
  }
  private input(input: StewardProfileInput): StewardProfileInput {
    const result = {
      name: input.name,
      responsibilities: input.responsibilities,
      background: input.background,
      context: input.context,
    };
    for (const key of [
      "name",
      "responsibilities",
      "background",
      "context",
    ] as const) {
      if (
        typeof result[key] !== "string" ||
        result[key].length > (key === "name" ? 100 : 20000)
      )
        throw new Error(`invalid_steward_${key}`);
      result[key] = result[key].trim();
    }
    if (!result.name || !result.responsibilities)
      throw new Error("steward_name_and_responsibilities_required");
    return result;
  }
  async create(input: StewardProfileInput) {
    await this.initialize();
    const item = {
      ...this.input(input),
      id: `steward-${randomUUID()}`,
      state: { version: 1 as const, tasks: [] },
      sessionIds: [],
    };
    await this.store.mutate((state) => ({
      ...state,
      instances: [...state.instances, item],
    }));
    // Entry exists durably even if the selected model/preset is temporarily unavailable.
    return { ...item, entryId: item.id };
  }
  async update(id: string, input: StewardProfileInput) {
    await this.initialize();
    const profile = this.input(input);
    await this.store.mutate((state) => {
      const item = state.instances.find((row) => row.id === id);
      if (!item) throw new Error("steward_deleted_or_unknown");
      Object.assign(item, profile);
      return state;
    });
    await this.engines.get(id)?.refreshTitle();
    return this.profile(id);
  }
  async remove(id: string) {
    await this.initialize();
    await this.store.mutate((state) => {
      if (!state.instances.some((row) => row.id === id))
        throw new Error("steward_deleted_or_unknown");
      return {
        ...state,
        instances: state.instances.filter((row) => row.id !== id),
      };
    });
    const engine = this.engines.get(id);
    this.engines.delete(id);
    if (engine) {
      // A steward may delete itself from its own tool call. Deactivate now,
      // release its agent after that turn, without waiting on our own caller.
      const cleanup = engine.dispose(true);
      this.cleanups.add(cleanup);
      void cleanup.finally(() => this.cleanups.delete(cleanup));
    }
    return { id, deleted: true };
  }
  async dispose() {
    await Promise.allSettled([
      ...this.cleanups,
      ...[...this.engines.values()].map((engine) => engine.dispose()),
    ]);
    this.engines.clear();
  }
}
