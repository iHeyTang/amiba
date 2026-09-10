import { createHash } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-mcp-client";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { scopeOf } from "@deepseek-ai/dsh-scope";

type ToolDefinition = Parameters<Context["tools"]["register"]>[0];

/** Official dsh-mcp-client naming contract, including its lossy-name hash.
 * Used only to match declared raw names to registrations, never to recover a
 * raw name by parsing a public name. Wire calls remain owned by the client.
 */
export function mcpPublicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash("sha256").update(`${serverName}\0${rawName}`).digest("hex").slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}

/** Private registration sink for an official MCP client. A connection alone
 * contributes no global tools. Approved consumers attach their own filtered
 * projections to the existing DSH ToolRuntime, preserving its normal pipeline.
 */
export class McpToolSurface {
  private definitions = new Map<string, ToolDefinition>();
  private projections = new Set<{
    accept(name: string): boolean;
    install(definition: ToolDefinition): void;
    remove(name: string): void;
    dispose(): void;
  }>();
  private closed = false;

  constructor(readonly serverName: string) {}

  requireTools(rawNames: readonly string[]): void {
    if (rawNames.some(name => !this.definitions.has(mcpPublicToolName(this.serverName, name))))
      throw new Error("mcp_dependency_tools_unavailable");
  }

  register = (definition: ToolDefinition): (() => void) => {
    if (this.closed) throw new Error("mcp_tool_surface_disposed");
    if (this.definitions.has(definition.name)) throw new Error("duplicate_mcp_tool");
    this.definitions.set(definition.name, definition);
    const installed: Array<{ remove(name: string): void }> = [];
    try {
      for (const projection of this.projections) {
        if (!projection.accept(definition.name)) continue;
        projection.install(definition);
        installed.push(projection);
      }
    } catch (error) {
      for (const projection of installed) projection.remove(definition.name);
      this.definitions.delete(definition.name);
      throw error;
    }
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.definitions.delete(definition.name);
      for (const projection of this.projections) projection.remove(definition.name);
    };
  };

  attach(ctx: Context, rawNames: readonly string[], signal: AbortSignal): () => void {
    return this.attachPublic(ctx, rawNames.map(name => mcpPublicToolName(this.serverName, name)), signal);
  }

  private attachPublic(ctx: Context, publicNames: readonly string[], signal: AbortSignal): () => void {
    if (this.closed || signal.aborted) throw new Error("mcp_lease_revoked");
    const allowed = new Set(publicNames);
    const removals = new Map<string, () => void>();
    let disposed = false;
    let removeMask = () => {};
    let removeGuard = () => {};
    let removeListener = () => {};
    const projection = {
      accept: (name: string) => allowed.has(name),
      install: (definition: ToolDefinition) => {
        type Execution = Parameters<ToolDefinition["execute"]>[1];
        const executions = new WeakMap<object, Execution>();
        const remove = ctx.tools.register({
          ...definition,
          async execute(args, exec) {
            if (signal.aborted || disposed) throw new Error("mcp_lease_revoked");
            if (validateJsonSchemaValue(definition.parameters, args).length)
              throw new Error("mcp_tool_arguments_invalid");
            const delegated = { ...exec, signal: AbortSignal.any([exec.signal, signal]) };
            executions.set(exec, delegated);
            const result = await definition.execute(args, delegated);
            if (signal.aborted || disposed) throw new Error("mcp_lease_revoked");
            return result;
          },
          finalizeContent(exec, result) {
            // The official client keys rich-result projections by execution.
            const delegated = executions.get(exec);
            executions.delete(exec);
            return definition.finalizeContent?.(delegated ?? exec, result);
          },
        });
        removals.set(definition.name, remove);
      },
      remove: (name: string) => {
        removals.get(name)?.();
        removals.delete(name);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        signal.removeEventListener("abort", projection.dispose);
        this.projections.delete(projection);
        removeListener();
        removeMask();
        removeGuard();
        for (const remove of removals.values()) remove();
        removals.clear();
      },
    };
    try {
      for (const definition of this.definitions.values()) {
        if (projection.accept(definition.name)) projection.install(definition);
      }
      this.projections.add(projection);
      const scope = scopeOf(ctx);
      if (scope) {
        // A separately enabled global consumer must not widen a plugin's grant
        // through inherited tools from the same shared MCP server.
        removeGuard = ctx.tools.guard(exec =>
          this.definitions.has(exec.name) && !allowed.has(exec.name)
            ? "mcp_tool_not_authorized" : undefined);
        let masking = false;
        let masked = "";
        const refreshMask = () => {
          if (masking || disposed) return;
          const denied = ctx.tools.schemas().map(tool => tool.name)
            .filter(name => this.definitions.has(name) && !allowed.has(name)).sort();
          const signature = JSON.stringify(denied);
          if (signature === masked) return;
          masking = true;
          try {
            masked = signature;
            removeMask();
            removeMask = denied.length ? ctx.tools.restrict({ deny: denied }) : () => {};
          } finally { masking = false; }
        };
        removeListener = ctx.on("tools/change", refreshMask);
        refreshMask();
      }
      signal.addEventListener("abort", projection.dispose, { once: true });
      if (signal.aborted) projection.dispose();
    } catch (error) {
      projection.dispose();
      throw error;
    }
    return projection.dispose;
  }

  dispose() {
    this.closed = true;
    for (const projection of [...this.projections]) projection.dispose();
    this.definitions.clear();
  }
}
