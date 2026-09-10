import type { Context } from "@deepseek-ai/cordis";

export type ToolSourceKind = "dsh-core" | "dsh-plugin" | "mcp-server";

export type ToolDistribution = "builtin" | "user";

export type ToolLoadMode = "core" | "plugin" | "mcp";
export type ToolExecutionTarget =
  | "dsh-runtime"
  | "desktop-service"
  | "external-process";

export interface ToolSourceDescriptor {
  kind: ToolSourceKind;
  /** Delivery origin, independent of vendor, transport and mount lifecycle. */
  distribution?: ToolDistribution;
  id: string;
  name: string;
  packageName?: string;
  loadMode: ToolLoadMode;
  executionTarget: ToolExecutionTarget;
  dynamic: boolean;
  provider?: string;
  displayName?: string;
  serviceId?: string;
  serviceName?: string;
  declaredBy?: string;
}


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
 * DSH plugin, runtime-gateway and MCP contributions. Registration contexts
 * supply delivery evidence for every tool, including user extensions.
 */
export class ToolProvenanceRegistry {
  constructor(readonly shippedBundles: readonly string[] = []) {}
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

  registerMcpServer(
    serverName: string,
    displayName?: string,
    origin?: Pick<
      ToolSourceDescriptor,
      "serviceId" | "serviceName" | "declaredBy" | "distribution"
    >,
  ): () => void {
    if (this.mcpServers.has(serverName)) {
      throw new Error(`MCP provenance already exists for ${serverName}`);
    }
    const source: ToolSourceDescriptor = Object.freeze({
      kind: "mcp-server",
      distribution: origin?.distribution ?? "user",
      id: "dsh-mcp-client",
      name: "DSH MCP Client",
      packageName: "@deepseek-ai/dsh-mcp-client",
      loadMode: "mcp",
      executionTarget: "external-process",
      dynamic: true,
      provider: serverName,
      displayName: displayName || serverName,
      ...origin,
    });
    this.mcpServers.set(serverName, source);
    return () => {
      if (this.mcpServers.get(serverName) === source) {
        this.mcpServers.delete(serverName);
      }
    };
  }

  resolve(name: string, composition?: ToolSourceDescriptor): ToolSourceDescriptor {
    const direct = this.tools.get(name);
    if (direct) return { ...direct, distribution: composition?.distribution ?? direct.distribution ?? "user" };

    // DSH's official MCP client preserves this complete server-qualified
    // prefix even when it hashes a long or invalid raw tool name.
    const server = [...this.mcpServers.keys()]
      .sort((left, right) => right.length - left.length)
      .find((candidate) => name.startsWith(`mcp__${candidate}__`));
    if (server) return this.mcpServers.get(server)!;
    if (composition) return composition;
    throw new Error(`Missing registration context for tool ${name}`);
  }
}

/** Attach source metadata to the same Cordis lifecycle as the owning plugin. */
export function registerToolSource(
  ctx: Context,
  name: string,
  source: ToolSourceDescriptor,
): void {
  const catalog = (
    ctx as Context & {
      amibaToolCatalog?: ToolProvenanceRegistry;
    }
  ).amibaToolCatalog;
  if (!catalog) return;
  ctx.effect(
    () => catalog.register(name, source),
    `amiba-tool-source:${source.id}:${name}`,
  );
}
