import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type { ToolProvenanceRegistry } from "@amiba/dsh-plugin-catalog";

import {
  DshMcpPluginSupervisor,
  type McpReloadTarget,
} from "./supervisor.js";

export type ManagedMcpServer =
  | {
      serverName: string;
      transport: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      enabled: boolean;
    }
  | {
      serverName: string;
      transport: "streamable-http";
      url: string;
      headers: Record<string, string>;
      enabled: boolean;
    };

export interface McpServerView {
  serverName: string;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys: string[];
  headerKeys: string[];
}

export interface McpSaveInput {
  serverName: string;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

interface StoreDocument {
  schemaVersion: 1;
  servers: ManagedMcpServer[];
}

const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u;

function storePath(root: string): string {
  return join(root, "servers.json");
}

function stringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, String(item)]),
  );
}

export function validateServer(input: ManagedMcpServer): ManagedMcpServer {
  const serverName = input.serverName.trim();
  if (!SERVER_NAME.test(serverName)) {
    throw new Error(
      "MCP server names must use 1-32 letters, digits, underscores, or hyphens.",
    );
  }
  if (input.transport === "stdio") {
    const command = input.command.trim();
    if (!command) throw new Error("A stdio MCP server requires a command.");
    return {
      serverName,
      transport: "stdio",
      command,
      args: input.args.map(String),
      env: stringRecord(input.env),
      ...(input.cwd?.trim() ? { cwd: input.cwd.trim() } : {}),
      enabled: Boolean(input.enabled),
    };
  }
  const url = new URL(input.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("An HTTP MCP server URL must use http or https.");
  }
  return {
    serverName,
    transport: "streamable-http",
    url: url.href,
    headers: stringRecord(input.headers),
    enabled: Boolean(input.enabled),
  };
}

async function readServers(root: string): Promise<ManagedMcpServer[]> {
  try {
    const parsed = JSON.parse(await readFile(storePath(root), "utf8")) as StoreDocument;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.servers)) {
      throw new Error("Unsupported DSH MCP store schema.");
    }
    const servers = parsed.servers.map(validateServer);
    if (new Set(servers.map((item) => item.serverName)).size !== servers.length) {
      throw new Error("DSH MCP server names must be unique.");
    }
    return servers;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeServers(root: string, servers: ManagedMcpServer[]): Promise<void> {
  const normalized = servers.map(validateServer);
  if (new Set(normalized.map((item) => item.serverName)).size !== normalized.length) {
    throw new Error("DSH MCP server names must be unique.");
  }
  const path = storePath(root);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ schemaVersion: 1, servers: normalized }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporary, path);
}

function view(server: ManagedMcpServer): McpServerView {
  return server.transport === "stdio"
    ? {
        serverName: server.serverName,
        transport: "stdio",
        enabled: server.enabled,
        command: server.command,
        args: server.args,
        ...(server.cwd ? { cwd: server.cwd } : {}),
        envKeys: Object.keys(server.env).sort(),
        headerKeys: [],
      }
    : {
        serverName: server.serverName,
        transport: "streamable-http",
        enabled: server.enabled,
        url: server.url,
        envKeys: [],
        headerKeys: Object.keys(server.headers).sort(),
      };
}

function replacement(input: McpSaveInput, existing?: ManagedMcpServer): ManagedMcpServer {
  if (input.transport === "stdio") {
    return validateServer({
      serverName: input.serverName,
      transport: "stdio",
      command: input.command ?? "",
      args: input.args ?? [],
      env: input.env ?? (existing?.transport === "stdio" ? existing.env : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      enabled: input.enabled,
    });
  }
  return validateServer({
    serverName: input.serverName,
    transport: "streamable-http",
    url: input.url ?? "",
    headers:
      input.headers ??
      (existing?.transport === "streamable-http" ? existing.headers : {}),
    enabled: input.enabled,
  });
}

/** Persistence and lifecycle owner for the dynamic official MCP child plugins. */
export class DshMcpManager implements McpReloadTarget {
  private readonly supervisor: Pick<DshMcpPluginSupervisor, "reload" | "dispose">;
  private readonly ready: Promise<void>;
  private mutation: Promise<unknown> = Promise.resolve();
  private readonly programmatic = new Map<string, ManagedMcpServer>();

  constructor(
    ctx: Context,
    private readonly root: string,
    provenance?: ToolProvenanceRegistry,
    supervisor?: Pick<DshMcpPluginSupervisor, "reload" | "dispose">,
  ) {
    this.supervisor = supervisor ?? new DshMcpPluginSupervisor(ctx, provenance);
    this.ready = readServers(root).then(async (servers) => {
      await this.supervisor.reload(this.merged(servers));
    });
  }

  private merged(stored: ManagedMcpServer[]): ManagedMcpServer[] {
    return [...stored, ...this.programmatic.values()];
  }

  async registerManagedServer(server: ManagedMcpServer): Promise<() => void> {
    const validated = validateServer(server);
    if (this.programmatic.has(validated.serverName))
      throw new Error(`duplicate managed MCP server ${validated.serverName}`);
    this.programmatic.set(validated.serverName, validated);
    return this.enqueue(async () => {
      try {
        const current = await readServers(this.root);
        if (current.some((item) => item.serverName === validated.serverName)) {
          this.programmatic.delete(validated.serverName);
          throw new Error(`duplicate managed MCP server ${validated.serverName}`);
        }
        await this.supervisor.reload(this.merged(current));
      } catch (error) {
        if (this.programmatic.get(validated.serverName) === validated) {
          this.programmatic.delete(validated.serverName);
        }
        throw error;
      }
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        if (this.programmatic.get(validated.serverName) !== validated) return;
        this.programmatic.delete(validated.serverName);
        void this.enqueue(async () => {
          await this.supervisor.reload(this.merged(await readServers(this.root)));
        });
      };
    });
  }

  async list(): Promise<{ servers: McpServerView[]; toolsOnly: true }> {
    await this.ready;
    await this.mutation;
    return { servers: (await readServers(this.root)).map(view), toolsOnly: true };
  }

  save(input: McpSaveInput): Promise<{ server: McpServerView }> {
    return this.enqueue(async () => {
      if (this.programmatic.has(input.serverName))
        throw new Error("name_reserved");
      const current = await readServers(this.root);
      const index = current.findIndex(
        (server) => server.serverName === input.serverName,
      );
      const next = replacement(input, index >= 0 ? current[index] : undefined);
      const updated = [...current];
      if (index >= 0) updated[index] = next;
      else updated.push(next);
      await this.commit(current, updated);
      return { server: view(next) };
    });
  }

  remove(serverName: string): Promise<{ serverName: string; deleted: boolean }> {
    return this.enqueue(async () => {
      const current = await readServers(this.root);
      const updated = current.filter((server) => server.serverName !== serverName);
      if (updated.length === current.length) {
        return { serverName, deleted: false };
      }
      await this.commit(current, updated);
      return { serverName, deleted: true };
    });
  }

  reload(values: unknown[]): Promise<{ generation: number; configured: string[] }> {
    return this.enqueue(async () => {
      const current = await readServers(this.root);
      const requested = values.map((value) => validateServer(value as ManagedMcpServer));
      await writeServers(this.root, requested);
      try {
        return await this.supervisor.reload(this.merged(requested));
      } catch (error) {
        await writeServers(this.root, current);
        await this.supervisor.reload(this.merged(current)).catch(() => undefined);
        throw error;
      }
    });
  }

  async dispose(): Promise<void> {
    await this.ready.catch(() => undefined);
    await this.mutation.catch(() => undefined);
    await this.supervisor.dispose();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = Promise.all([this.ready, this.mutation]).then(operation);
    this.mutation = task.catch(() => undefined);
    return task;
  }

  private async commit(
    previous: ManagedMcpServer[],
    next: ManagedMcpServer[],
  ): Promise<void> {
    await writeServers(this.root, next);
    try {
      await this.supervisor.reload(this.merged(next));
    } catch (error) {
      await writeServers(this.root, previous);
      await this.supervisor.reload(this.merged(previous)).catch(() => undefined);
      throw error;
    }
  }
}
