import { createHash, randomUUID } from "node:crypto";
import type { ManagedMcpServer } from "./manager.js";
import { McpDependencyBinding } from "./dependency-binding.js";
import type { Context } from "@deepseek-ai/cordis";
import { scopeOf } from "@deepseek-ai/dsh-scope";

export interface McpOwner {
  id: string;
  name: string;
}
export interface McpServiceDefinition {
  id: string;
  name: string;
  version: string;
  /** Only stateless services that can safely share a connection opt in. */
  shareable?: boolean;
}
export type McpLaunchSettings =
  | Omit<
      Extract<ManagedMcpServer, { transport: "stdio" }>,
      "serverName" | "displayName" | "required" | "origin"
    >
  | Omit<
      Extract<ManagedMcpServer, { transport: "streamable-http" }>,
      "serverName" | "displayName" | "required" | "origin"
    >;

export interface McpConnectionDefinition {
  /** Delivery origin supplied by the configuration owner, independent of MCP transport. */
  distribution?: "builtin" | "user";
  id: string;
  name: string;
  serviceId: string;
  /** Explicit tenant/account/authorization identity, never a credential. */
  identity: string;
  configuration?: { ownerId: string; recordId: string };
  /** Private launch settings, supplied by the configuration owner. Never projected. */
  server: McpLaunchSettings;
}
export interface McpDependency {
  owner: McpOwner;
  serviceId: string;
  /** Exact supported implementation version; no implicit version upgrade. */
  version: string;
  connectionId: string;
  /** Pin an approved account identity; credential rotation may retain this identity. */
  identity?: string;
  sharing?: "isolated" | "shared";
  /** Explicit raw MCP tools needed by this consumer; defaults to no tools. */
  tools?: string[];
  /** Product plugin grants must target an agent scope, never the global table. */
  requireScope?: boolean;
}
export interface McpLease {
  serverName: string;
  identity: string;
  /** Aborted when the owner revokes or changes the connection, or service unloads. */
  signal: AbortSignal;
  expose(ctx: Context): () => void;
  release(): Promise<void>;
}
export interface McpDependencyView {
  connectionId: string;
  name: string;
  service: string;
  provider: string;
  consumers: string[];
  instances: number;
  state: "available" | "in-use" | "error";
}
type Release = () => void | Promise<void>;
type Service = {
  owner: McpOwner;
  definition: McpServiceDefinition;
  refs: number;
};
type Connection = {
  owner: McpOwner;
  definition: McpConnectionDefinition;
  error: boolean;
  revoking: boolean;
};
type Instance = {
  connection: Connection;
  serverName: string;
  closing: boolean;
  release: Release;
  leases: Map<string, { owner: McpOwner; controller: AbortController }>;
};

/** Runtime leases only. Plugin configuration remains with its owning plugin. */
export class McpDependencies {
  private services = new Map<string, Service>();
  private connections = new Map<string, Connection>();
  private instances = new Map<string, Instance>();
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;
  private listeners = new Set<() => void>();
  constructor(
    private mount: (server: ManagedMcpServer) => Promise<Release>,
    private expose?: (serverName: string, ctx: Context, tools: readonly string[], signal: AbortSignal) => () => void,
    private rename?: (serverName: string, name: string) => Promise<void>,
    private requireTools?: (serverName: string, tools: readonly string[]) => void,
  ) {}

  /** Provider changes only: consumer acquisition must never trigger retry loops. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed() {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Observers cannot break provider updates. */ }
    }
  }

  bind(request: McpDependency, signal?: AbortSignal): McpDependencyBinding {
    return new McpDependencyBinding(this, structuredClone(request), signal);
  }

  private run<T>(operation: () => Promise<T> | T): Promise<T> {
    const task = this.pending.then(() => {
      if (this.closed) throw new Error("mcp_dependencies_disposed");
      return operation();
    });
    this.pending = task.catch(() => undefined);
    return task;
  }

  registerService(
    owner: McpOwner,
    definition: McpServiceDefinition,
  ): Promise<Release> {
    owner = structuredClone(owner);
    definition = structuredClone(definition);
    return this.run(() => {
      if (!owner.id || !definition.id || !definition.version)
        throw new Error("invalid_mcp_service");
      const existing = this.services.get(definition.id);
      if (
        existing &&
        (existing.owner.id !== owner.id ||
          JSON.stringify(existing.definition) !== JSON.stringify(definition))
      )
        throw new Error("mcp_service_conflict");
      const service = existing ?? {
        owner: structuredClone(owner),
        definition: structuredClone(definition),
        refs: 0,
      };
      service.refs++;
      this.services.set(definition.id, service);
      this.changed();
      let released = false;
      return async () => {
        if (released || this.closed) return;
        await this.run(async () => {
          if (released) return;
          if (service.refs > 1) {
            service.refs--;
            released = true;
            return;
          }
          for (const [id, connection] of this.connections) {
            if (connection.definition.serviceId === definition.id) {
              await this.revoke(connection);
              this.connections.delete(id);
            }
          }
          this.services.delete(definition.id);
          this.changed();
          released = true;
        });
      };
    });
  }

  registerConnection(
    owner: McpOwner,
    definition: McpConnectionDefinition,
  ): Promise<Release> {
    owner = structuredClone(owner);
    definition = structuredClone(definition);
    return this.run(() => {
      const service = this.services.get(definition.serviceId);
      if (!service || service.owner.id !== owner.id)
        throw new Error("mcp_connection_owner_mismatch");
      if (
        !definition.id ||
        !definition.identity ||
        this.connections.has(definition.id)
      )
        throw new Error("mcp_connection_conflict");
      const connection = {
        owner: structuredClone(owner),
        definition: structuredClone(definition),
        error: false,
        revoking: false,
      };
      this.connections.set(definition.id, connection);
      this.changed();
      let released = false;
      return async () => {
        if (released || this.closed) return;
        await this.run(async () => {
          if (released) return;
          if (this.connections.get(definition.id) !== connection) return;
          await this.revoke(connection);
          this.connections.delete(definition.id);
          this.changed();
          released = true;
        });
      };
    });
  }

  /** Owner-only replacement. Old leases abort before new credentials can be used. */
  updateConnection(
    ownerId: string,
    definition: McpConnectionDefinition,
  ): Promise<void> {
    definition = structuredClone(definition);
    return this.run(async () => {
      const connection = this.connections.get(definition.id);
      if (
        !connection ||
        connection.owner.id !== ownerId ||
        connection.definition.serviceId !== definition.serviceId
      )
        throw new Error("mcp_connection_owner_mismatch");
      if (!definition.identity) throw new Error("invalid_mcp_identity");
      await this.revoke(connection);
      connection.definition = structuredClone(definition);
      connection.error = false;
      connection.revoking = false;
      this.changed();
    });
  }

  renameConnection(ownerId: string, connectionId: string, name: string): Promise<void> {
    return this.run(async () => {
      const connection = this.connections.get(connectionId);
      if (!connection || connection.owner.id !== ownerId) throw new Error("mcp_connection_owner_mismatch");
      if (!name.trim()) throw new Error("invalid_mcp_connection_name");
      for (const instance of this.instances.values()) {
        if (instance.connection === connection) await this.rename?.(instance.serverName, name.trim());
      }
      connection.definition.name = name.trim();
      this.changed();
    });
  }

  acquire(request: McpDependency): Promise<McpLease> {
    request = structuredClone(request);
    return this.run(async () => {
      if (!request.owner.id) throw new Error("invalid_mcp_consumer");
      const service = this.services.get(request.serviceId);
      const connection = this.connections.get(request.connectionId);
      if (
        !service ||
        !connection ||
        connection.definition.serviceId !== request.serviceId
      )
        throw new Error("mcp_dependency_unavailable");
      if (request.version !== service.definition.version)
        throw new Error("mcp_dependency_version_mismatch");
      if (request.identity && request.identity !== connection.definition.identity)
        throw new Error("mcp_dependency_identity_mismatch");
      if (connection.revoking) throw new Error("mcp_dependency_stopping");
      if (!connection.definition.server.enabled)
        throw new Error("mcp_connection_disabled");
      if (request.sharing === "shared" && !service.definition.shareable)
        throw new Error("mcp_sharing_not_supported");
      const leaseId = randomUUID();
      const key = JSON.stringify([
        request.connectionId,
        request.version,
        request.sharing === "shared" ? "shared" : leaseId,
      ]);
      let instance = this.instances.get(key);
      if (instance?.closing) throw new Error("mcp_dependency_stopping");
      if (!instance) {
        const serverName = `dep-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
        try {
          const release = await this.mount({
            ...connection.definition.server,
            serverName,
            required: true,
            displayName: connection.definition.name,
            origin: {
              serviceId: request.serviceId,
              serviceName: service.definition.name,
              declaredBy: service.owner.name,
              distribution: connection.definition.distribution ?? "user",
            },
          });
          instance = {
            connection,
            serverName,
            closing: false,
            release,
            leases: new Map(),
          };
          this.instances.set(key, instance);
          connection.error = false;
        } catch {
          connection.error = true;
          // Launch errors can contain credentials. Keep public dependency errors stable.
          throw new Error("mcp_dependency_start_failed");
        }
      }
      try { this.requireTools?.(instance.serverName, request.tools ?? []); }
      catch {
        if (!instance.leases.size) {
          instance.closing = true;
          await instance.release();
          this.instances.delete(key);
        }
        throw new Error("mcp_dependency_tools_unavailable");
      }
      const controller = new AbortController();
      instance.leases.set(leaseId, {
        owner: structuredClone(request.owner),
        controller,
      });
      let released = false;
      return {
        serverName: instance.serverName,
        identity: connection.definition.identity,
        signal: controller.signal,
        expose: (ctx) => {
          if (controller.signal.aborted) throw new Error("mcp_lease_revoked");
          if (request.requireScope && !scopeOf(ctx)) throw new Error("mcp_plugin_scope_required");
          if (!this.expose) throw new Error("mcp_tool_surface_unavailable");
          return this.expose(instance.serverName, ctx, request.tools ?? [], controller.signal);
        },
        release: async () => {
          if (released || this.closed) return;
          await this.run(async () => {
            if (released) return;
            const current = this.instances.get(key);
            controller.abort();
            if (!current) {
              released = true;
              return;
            }
            current.leases.delete(leaseId);
            if (current.leases.size === 0) {
              current.closing = true;
              try {
                await current.release();
              } catch (error) {
                current.connection.error = true;
                throw error;
              }
              this.instances.delete(key);
            }
            released = true;
          });
        },
      };
    });
  }

  private async revoke(connection: Connection) {
    connection.revoking = true;
    const entries = [...this.instances].filter(
      ([, instance]) => instance.connection === connection,
    );
    // Abort every consumer before awaiting any one server's shutdown.
    for (const [, instance] of entries) {
      instance.closing = true;
      for (const lease of instance.leases.values()) lease.controller.abort();
    }
    const errors: unknown[] = [];
    for (const [key, instance] of entries) {
      try {
        await instance.release();
        this.instances.delete(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      connection.error = true;
      throw errors[0];
    }
  }

  async list(): Promise<McpDependencyView[]> {
    await this.pending;
    return [...this.connections.values()].map((connection) => {
      const instances = [...this.instances.values()].filter(
        (item) => item.connection === connection,
      );
      return {
        connectionId: connection.definition.id,
        name: connection.definition.name,
        service: this.services.get(connection.definition.serviceId)!.definition
          .name,
        provider: connection.owner.name,
        consumers: [
          ...new Set(
            instances.flatMap((item) =>
              [...item.leases.values()].map((lease) => lease.owner.name),
            ),
          ),
        ],
        instances: instances.length,
        state: connection.error
          ? "error"
          : instances.length
            ? "in-use"
            : "available",
      };
    });
  }

  /** Configuration references for the approval service; never launch settings. */
  async connectionsFor(serviceId: string, version: string) {
    await this.pending;
    const service = this.services.get(serviceId);
    if (!service || service.definition.version !== version) return [];
    return [...this.connections.values()]
      .filter(connection => connection.definition.serviceId === serviceId && !connection.revoking && connection.definition.server.enabled)
      .map(connection => ({ id: connection.definition.id, name: connection.definition.name,
        identity: connection.definition.identity, provider: connection.owner.name,
        configuration: connection.definition.configuration ? structuredClone(connection.definition.configuration) : undefined }));
  }

  async dispose() {
    await this.pending;
    this.closed = true;
    this.changed();
    const errors: unknown[] = [];
    for (const connection of this.connections.values()) {
      try {
        await this.revoke(connection);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw errors[0];
    this.connections.clear();
    this.services.clear();
    this.listeners.clear();
  }
}
