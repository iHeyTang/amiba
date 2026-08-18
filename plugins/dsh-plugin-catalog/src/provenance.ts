import type { Context } from "@deepseek-ai/cordis";

export type ToolSourceKind = "dsh-core" | "dsh-plugin" | "mcp-server";

export type ToolLoadMode = "core" | "plugin" | "mcp";
export type ToolExecutionTarget =
  | "dsh-runtime"
  | "desktop-service"
  | "external-process";

export interface ToolSourceDescriptor {
  kind: ToolSourceKind;
  id: string;
  name: string;
  packageName?: string;
  loadMode: ToolLoadMode;
  executionTarget: ToolExecutionTarget;
  dynamic: boolean;
  provider?: string;
}

const DSH_SOURCE: ToolSourceDescriptor = Object.freeze({
  kind: "dsh-core",
  id: "managed-dsh-profile:web",
  name: "DeepSeek Harness",
  packageName: "@deepseek-ai/dsh-base",
  loadMode: "core",
  executionTarget: "dsh-runtime",
  dynamic: false,
});

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaToolCatalog: ToolProvenanceRegistry;
  }
}

/**
 * Product-owned provenance for every non-stock tool mounted into DSH.
 *
 * ToolRuntime exposes the effective schemas but not their owning Cordis fiber.
 * Amiba therefore records ownership at the same boundary where it mounts
 * DSH plugin, runtime-gateway and MCP contributions. Anything left unclaimed belongs to
 * the immutable stock DSH profile used by the managed runtime.
 */
export class ToolProvenanceRegistry {
  private readonly tools = new Map<string, ToolSourceDescriptor>();
  private readonly mcpServers = new Map<string, ToolSourceDescriptor>();

  register(name: string, source: ToolSourceDescriptor): () => void {
    if (this.tools.has(name)) {
      throw new Error(`tool provenance already exists for ${name}`);
    }
    this.tools.set(name, Object.freeze({ ...source }));
    return () => {
      if (this.tools.get(name)?.id === source.id) this.tools.delete(name);
    };
  }

  registerMcpServer(serverName: string): () => void {
    if (this.mcpServers.has(serverName)) {
      throw new Error(`MCP provenance already exists for ${serverName}`);
    }
    const source: ToolSourceDescriptor = Object.freeze({
      kind: "mcp-server",
      id: "dsh-mcp-client",
      name: "DSH MCP Client",
      packageName: "@deepseek-ai/dsh-mcp-client",
      loadMode: "mcp",
      executionTarget: "external-process",
      dynamic: true,
      provider: serverName,
    });
    this.mcpServers.set(serverName, source);
    return () => {
      if (this.mcpServers.get(serverName) === source) {
        this.mcpServers.delete(serverName);
      }
    };
  }

  resolve(name: string): ToolSourceDescriptor {
    const direct = this.tools.get(name);
    if (direct) return direct;

    // DSH's official MCP client preserves this complete server-qualified
    // prefix even when it hashes a long or invalid raw tool name.
    const server = [...this.mcpServers.keys()]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => name.startsWith(`mcp__${candidate}__`));
    return server ? this.mcpServers.get(server)! : DSH_SOURCE;
  }
}

/** Attach source metadata to the same Cordis lifecycle as the owning plugin. */
export function registerToolSource(
  ctx: Context,
  name: string,
  source: ToolSourceDescriptor,
): void {
  const catalog = (ctx as Context & {
    amibaToolCatalog?: ToolProvenanceRegistry;
  }).amibaToolCatalog;
  if (!catalog) return;
  ctx.effect(
    () => catalog.register(name, source),
    `amiba-tool-source:${source.id}:${name}`,
  );
}
