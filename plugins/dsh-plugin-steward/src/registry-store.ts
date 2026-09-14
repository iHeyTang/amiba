import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { StewardState } from "./types.js";

export interface StewardProfile {
  id: string;
  name: string;
  responsibilities: string;
  background: string;
  context: string;
}
export interface StewardInstance extends StewardProfile {
  state: StewardState;
  sessionIds: string[];
}
export interface StewardRegistry {
  version: 2;
  instances: StewardInstance[];
}
export type StewardProfileInput = Omit<StewardProfile, "id">;

/** One atomic document is also the transaction boundary for exclusive task ownership. */
export class StewardRegistryStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();
  private cached?: StewardRegistry;
  constructor(private readonly root: string) {
    this.path = join(root, "state.json");
  }
  snapshot(): StewardRegistry {
    if (!this.cached) throw new Error("steward_registry_not_ready");
    return structuredClone(this.cached);
  }
  private async load(): Promise<StewardRegistry> {
    if (this.cached) return this.snapshot();
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      parsed = { version: 1, tasks: [] };
    }
    if (!parsed || typeof parsed !== "object")
      throw new Error("invalid_steward_registry");
    const row = parsed as StewardRegistry;
    if (row.version === 2 && Array.isArray(row.instances)) {
      const ids = new Set<string>();
      for (const item of row.instances) {
        if (
          !item ||
          !item.id ||
          ids.has(item.id) ||
          ![
            item.name,
            item.responsibilities,
            item.background,
            item.context,
          ].every((value) => typeof value === "string") ||
          !Array.isArray(item.sessionIds) ||
          item.sessionIds.some((id) => typeof id !== "string") ||
          item.state?.version !== 1 ||
          !Array.isArray(item.state.tasks) ||
          item.state.tasks.some(
            (task) =>
              !task ||
              typeof task.id !== "string" ||
              typeof task.sessionId !== "string",
          )
        )
          throw new Error("invalid_steward_registry");
        ids.add(item.id);
      }
      this.cached = parsed as StewardRegistry;
    } else if (
      (parsed as StewardState).version === 1 &&
      Array.isArray((parsed as StewardState).tasks)
    ) {
      const state = parsed as StewardState;
      this.cached = {
        version: 2,
        instances: [
          {
            id: "main",
            name: "大管家",
            responsibilities: "帮助用户管理任务、跟进进展并汇报结果",
            background: "",
            context: "",
            state,
            sessionIds: state.stewardSessionId ? [state.stewardSessionId] : [],
          },
        ],
      };
    } else throw new Error("invalid_steward_registry");
    return this.snapshot();
  }
  async read(): Promise<StewardRegistry> {
    await this.chain;
    return this.load();
  }
  mutate(
    update: (state: StewardRegistry) => StewardRegistry,
  ): Promise<StewardRegistry> {
    const result = this.chain.then(async () => {
      const next = update(await this.load());
      const stewardSessions = new Set<string>();
      for (const instance of next.instances) {
        for (const sessionId of instance.sessionIds) {
          if (stewardSessions.has(sessionId))
            throw new Error("steward_session_already_owned");
          stewardSessions.add(sessionId);
        }
      }
      const owners = new Set<string>();
      for (const instance of next.instances)
        for (const task of instance.state.tasks) {
          if (stewardSessions.has(task.sessionId))
            throw new Error("steward_session_cannot_be_task");
          if (owners.has(task.sessionId))
            throw new Error("session_already_managed");
          owners.add(task.sessionId);
        }
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {
        mode: 0o600,
      });
      await rename(temporary, this.path);
      this.cached = structuredClone(next);
      return this.snapshot();
    });
    this.chain = result.catch(() => undefined);
    return result;
  }
  scoped(id: string) {
    const get = (registry: StewardRegistry) => {
      const instance = registry.instances.find((item) => item.id === id);
      if (!instance) throw new Error("steward_deleted_or_unknown");
      return instance;
    };
    return {
      read: async () => get(await this.read()).state,
      mutate: async (update: (state: StewardState) => StewardState) => {
        const result = await this.mutate((registry) => {
          const instance = get(registry);
          instance.state = update(instance.state);
          if (
            instance.state.stewardSessionId &&
            !instance.sessionIds.includes(instance.state.stewardSessionId)
          )
            instance.sessionIds.push(instance.state.stewardSessionId);
          return registry;
        });
        return get(result).state;
      },
    };
  }
}
