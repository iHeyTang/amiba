import { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { Storage } from "@deepseek-ai/dsh-storage";
import { JsonStorageBackend } from "@deepseek-ai/dsh-storage-json";
import {
  DomainFacility,
  type DomainSpec,
  type Domain,
} from "@deepseek-ai/dsh-storage-domain";
import { dirname, join } from "node:path";

export const name = "amiba-session-storage";
export const inject = ["agents", "sessionPersistence"];
const SEGMENT = /^[a-z][a-z0-9-]*$/;
/** One official domain facility per session/plugin namespace. Consumers never receive paths. */
export class SessionStorage {
  private scopes = new Map<
    string,
    Promise<{ facility: DomainFacility; close(): Promise<void> }>
  >();
  private closing = false;
  private opening = new Set<Promise<unknown>>();
  private disposal?: Promise<void>;
  constructor(private ctx: Context) {}
  open<S extends DomainSpec>(
    sessionId: string,
    namespace: string,
    spec: S,
  ): Promise<Domain<S>> {
    if (this.closing) return Promise.reject(new Error("Session storage is closing"));
    const operation = this.openDomain(sessionId, namespace, spec);
    this.opening.add(operation);
    void operation.finally(() => this.opening.delete(operation)).catch(() => {});
    return operation;
  }
  private async openDomain<S extends DomainSpec>(sessionId: string, namespace: string, spec: S): Promise<Domain<S>> {
    if (!SEGMENT.test(namespace))
      throw new Error("Invalid plugin storage namespace");
    const key = JSON.stringify([sessionId, namespace]);
    let pending = this.scopes.get(key);
    if (!pending) {
      pending = this.create(sessionId, namespace);
      this.scopes.set(key, pending);
      void pending.catch(() => {
        if (this.scopes.get(key) === pending) this.scopes.delete(key);
      });
    }
    const { facility } = await pending;
    return facility.open(spec);
  }
  private async create(sessionId: string, namespace: string) {
    // Resolve through the authoritative session backend; never construct a path from an RPC id.
    const id = sessionId as SessionId;
    const live = this.ctx.agents.get(id);
    const header =
      live?.session.header ??
      (await this.ctx.sessionPersistence.inspect(id)).meta;
    if (header.id !== id) throw new Error("Session storage identity mismatch");
    const location = this.ctx.sessionPersistence.locate(header);
    if (location?.kind !== "jsonl")
      throw new Error(
        "Session-local plugin storage requires a JSONL session backend",
      );
    const scope = new Context();
    const storage = new Storage(scope);
    const backend = new JsonStorageBackend(
      join(dirname(location.path), "plugins", namespace),
    );
    const unregister = storage.backend.register("json", backend);
    const facility = new DomainFacility(scope, { backend: "json" });
    return {
      facility,
      close: async () => {
        try {
          await facility.closeAll();
        } finally {
          unregister();
          await backend.close();
          await scope.fiber.dispose();
        }
      },
    };
  }
  close(): Promise<void> {
    this.closing = true;
    return this.disposal ??= this.drain();
  }
  private async drain() {
    await Promise.allSettled([...this.opening]);
    const scopes = await Promise.allSettled([...this.scopes.values()]);
    const closed = await Promise.allSettled(scopes.flatMap(result => result.status === "fulfilled" ? [result.value.close()] : []));
    this.scopes.clear();
    const failures = closed.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Session storage could not drain all domains");
  }
}
declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaSessionStorage: SessionStorage;
  }
}
export function apply(ctx: Context) {
  const storage = new SessionStorage(ctx);
  ctx.provide("amibaSessionStorage", storage);
  ctx.effect(
    () => () => storage.close(),
    "session-storage: drain official domains",
  );
}
