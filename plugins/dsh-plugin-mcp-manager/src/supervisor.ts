import type { Context } from "@deepseek-ai/cordis";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolProvenanceRegistry } from "@amiba/dsh-plugin-catalog";

const ROUTE = "/api/amiba/mcp/reload";
const MAX_BODY_BYTES = 1024 * 1024;
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/u;

export interface McpHttpConfig {
  apiToken: string;
}

type ManagedMcpServer =
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

interface WebServerFace {
  register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
}

interface MountedServer {
  signature: string;
  config: mcpClient.Config;
  dispose(): Promise<void>;
  disposeProvenance(): void;
}

export interface McpReloadTarget {
  reload(values: unknown[]): Promise<{ generation: number; configured: string[] }>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringRecord(value: unknown, field: string): Record<string, string> {
  const source = record(value);
  if (!source) throw new Error(`${field} must be an object of string values`);
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => {
      if (typeof item !== "string")
        throw new Error(`${field}.${key} must be a string`);
      return [key, item];
    }),
  );
}

function requiredString(
  source: Record<string, unknown>,
  field: string,
): string {
  const value = source[field];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required`);
  return value.trim();
}

function normalizeServer(
  value: unknown,
): { name: string; config: mcpClient.Config } | undefined {
  const source = record(value);
  if (!source) throw new Error("MCP server must be an object");
  if (source.enabled === false) return undefined;
  const serverName = requiredString(source, "serverName");
  if (!SERVER_NAME.test(serverName)) {
    throw new Error(
      "MCP serverName must use 1-32 letters, digits, underscores, or hyphens",
    );
  }
  if (source.transport === "stdio") {
    if (
      !Array.isArray(source.args) ||
      !source.args.every((item) => typeof item === "string")
    ) {
      throw new Error(
        `MCP server ${serverName} args must be an array of strings`,
      );
    }
    const cwd = typeof source.cwd === "string" ? source.cwd.trim() : "";
    return {
      name: serverName,
      config: {
        transport: "stdio",
        serverName,
        command: requiredString(source, "command"),
        args: source.args,
        env: stringRecord(source.env, "env"),
        cwd,
        toolCallTimeoutMs: 60_000,
        failOnStartupError: false,
      },
    };
  }
  if (source.transport !== "streamable-http") {
    throw new Error(`MCP server ${serverName} has an unsupported transport`);
  }
  const url = new URL(requiredString(source, "url"));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP server ${serverName} URL must use http or https`);
  }
  return {
    name: serverName,
    config: {
      transport: "streamable-http",
      serverName,
      url: url.href,
      headers: stringRecord(source.headers, "headers"),
      toolCallTimeoutMs: 60_000,
      failOnStartupError: false,
    },
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    throw new Error("content_type");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  const body = record(value);
  if (!body) throw new Error("invalid_body");
  return body;
}

/** Owns dynamic instances of DSH's official one-server MCP client plugin. */
export class DshMcpPluginSupervisor {
  private mounted = new Map<string, MountedServer>();
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly ctx: Context,
    private readonly provenance?: ToolProvenanceRegistry,
  ) {}

  private async mount(
    name: string,
    config: mcpClient.Config,
  ): Promise<MountedServer> {
    const disposeProvenance =
      this.provenance?.registerMcpServer(name) ?? (() => undefined);
    try {
      const fiber = await this.ctx.plugin(mcpClient, config);
      return {
        signature: JSON.stringify(config),
        config,
        dispose: () => fiber.dispose(),
        disposeProvenance,
      };
    } catch (error) {
      disposeProvenance();
      throw error;
    }
  }

  reload(
    values: unknown[],
  ): Promise<{ generation: number; configured: string[] }> {
    const task = this.queue.then(() => this.applyGeneration(values));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async applyGeneration(values: unknown[]) {
    const requested = new Map<string, mcpClient.Config>();
    for (const value of values) {
      const server = normalizeServer(value);
      if (!server) continue;
      if (requested.has(server.name))
        throw new Error(`Duplicate MCP serverName ${server.name}`);
      requested.set(server.name, server.config);
    }

    const signatures = new Map(
      [...requested].map(([name, config]) => [name, JSON.stringify(config)]),
    );
    const replaced = new Map<string, mcpClient.Config>();
    for (const [name, mounted] of this.mounted) {
      if (signatures.get(name) === mounted.signature) continue;
      replaced.set(name, mounted.config);
      await mounted.dispose();
      mounted.disposeProvenance();
      this.mounted.delete(name);
    }

    const added: string[] = [];
    try {
      for (const [name, config] of requested) {
        if (this.mounted.has(name)) continue;
        const mounted = await this.mount(name, config);
        mounted.signature = signatures.get(name)!;
        this.mounted.set(name, mounted);
        added.push(name);
      }
    } catch (error) {
      for (const name of added.reverse()) {
        await this.mounted
          .get(name)
          ?.dispose()
          .catch(() => undefined);
        this.mounted.get(name)?.disposeProvenance();
        this.mounted.delete(name);
      }
      // Best-effort rollback of replaced live clients. A failed rollback is
      // logged by Cordis and remains visible as a failed management request.
      for (const [name, config] of replaced) {
        this.mounted.set(name, await this.mount(name, config));
      }
      throw error;
    }

    this.generation += 1;
    return {
      generation: this.generation,
      configured: [...this.mounted.keys()].sort(),
    };
  }

  async dispose(): Promise<void> {
    await this.queue.catch(() => undefined);
    for (const mounted of [...this.mounted.values()].reverse()) {
      await mounted.dispose().catch(() => undefined);
      mounted.disposeProvenance();
    }
    this.mounted.clear();
  }
}

/** Register the authenticated host-management face for dynamic official MCP clients. */
export function applyMcpHttp(
  ctx: Context,
  config: McpHttpConfig,
  provenance?: ToolProvenanceRegistry,
  target?: McpReloadTarget,
): void {
  if (!config.apiToken || config.apiToken.length < 32) {
    throw new Error("amiba MCP API token must contain at least 32 characters");
  }
  const supervisor = target ?? new DshMcpPluginSupervisor(ctx, provenance);
  if (!target) {
    ctx.effect(
      () => () => (supervisor as DshMcpPluginSupervisor).dispose(),
      "amiba-mcp-supervisor",
    );
  }
  const server = (ctx as Context & { webServer: WebServerFace }).webServer;
  ctx.effect(
    () =>
      server.register({
        kind: "exact",
        path: ROUTE,
        async handler(req, res) {
          if (req.headers["x-amiba-plugin-token"] !== config.apiToken) {
            json(res, 401, { ok: false, error: "unauthorized" });
            return;
          }
          try {
            if (req.method !== "POST") {
              res.setHeader("allow", "POST");
              json(res, 405, { ok: false, error: "method_not_allowed" });
              return;
            }
            const body = await readBody(req);
            if (!Array.isArray(body.servers))
              throw new Error("servers must be an array");
            json(res, 200, {
              ok: true,
              ...(await supervisor.reload(body.servers)),
            });
          } catch (error) {
            const message =
              error instanceof Error ? error.message : "internal_error";
            const status =
              message === "content_type"
                ? 415
                : message === "body_too_large"
                  ? 413
                  : 400;
            json(res, status, { ok: false, error: message });
          }
        },
      }),
    "amiba-mcp-manager:http",
  );
}
