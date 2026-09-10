import { registrationSource, shippedEntries } from "./registration-source.js";
import type AgentPresets from "@deepseek-ai/dsh-agent-presets";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-tools";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolProvenanceRegistry, ToolSourceDescriptor } from "./provenance.js";

const ROUTE = "/api/amiba/tools";

export interface ToolsHttpConfig {
  apiToken: string;
}

interface WebServerFace {
  register(route: {
    kind: "exact";
    path: string;
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>;
  }): () => void;
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

function authorized(req: IncomingMessage, token: string): boolean {
  const supplied = req.headers["x-amiba-plugin-token"];
  return typeof supplied === "string" && supplied === token;
}

type CatalogContext = Context & { agentPresets: AgentPresets };

/** Project every tool registered by the runtime, independent of sessions. */
export async function toolInventory(
  ctx: Context,
  provenance: ToolProvenanceRegistry,
) {
  const catalogCtx = ctx as CatalogContext;
  const shipped = shippedEntries(ctx, provenance.shippedBundles);
  const tools: Array<{ id: string; name: string; description?: string; parameters: unknown; source: ToolSourceDescriptor }> = [];
  const definitions = new Set<unknown>();
  const builtinCapabilities = new Set<string>();
  const append = (scope?: Parameters<Context["tools"]["get"]>[1], preset?: { id: string; name?: string; trust: "system" | "user" }) => {
    for (const schema of ctx.tools.schemas(scope)) {
      const definition = ctx.tools.get(schema.name, scope);
      if (definitions.has(definition)) continue;
      const owner = ctx.tools.registrationContext(schema.name, scope);
      if (!owner) throw new Error(`Tool registration is missing its owner: ${schema.name}`);
      definitions.add(definition);
      const globalDefinition = ctx.tools.get(schema.name);
      const source = provenance.resolve(schema.name, registrationSource(owner, shipped, definition === globalDefinition ? undefined : preset));
      // System presets can mount the same shipped capability independently.
      // Collapse those copies, while preserving user overrides in their own scopes.
      const builtinKey = JSON.stringify([source.packageName ?? source.id, schema.name, schema.description, schema.parameters]);
      if (source.distribution === "builtin") {
        if (builtinCapabilities.has(builtinKey)) continue;
        builtinCapabilities.add(builtinKey);
      }
      tools.push({ ...schema, id: `${preset?.id ?? "global"}:${schema.name}`, source });
    }
  };
  append();
  const presets = (await catalogCtx.agentPresets.list()).filter(preset => !preset.broken).sort((a, b) => a.id.localeCompare(b.id));
  for (const preset of presets) append(await catalogCtx.agentPresets.standingKeyFor(preset.id), preset);
  return { tools: tools.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };

}

/**
 * Expose the complete runtime tool catalog without selecting or creating a
 * session. Official preset tools are read through DSH standing scopes; global
 * Amiba plugin and MCP contributions are included by the registry parent chain.
 */
export function applyToolsHttp(
  ctx: Context,
  config: ToolsHttpConfig,
  provenance: ToolProvenanceRegistry,
): void {
  if (!config.apiToken || config.apiToken.length < 32) {
    throw new Error(
      "amiba tools API token must contain at least 32 characters",
    );
  }
  const server = (ctx as Context & { webServer: WebServerFace }).webServer;
  ctx.effect(
    () =>
      server.register({
        kind: "exact",
        path: ROUTE,
        async handler(req: IncomingMessage, res: ServerResponse) {
          if (!authorized(req, config.apiToken)) {
            json(res, 401, { ok: false, error: "unauthorized" });
            return;
          }
          if (req.method !== "GET") {
            res.setHeader("allow", "GET");
            json(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }

          const value = await toolInventory(ctx, provenance);
          json(res, 200, {
            ok: true,
            value,
          });
        },
      }),
    "amiba-tool-catalog:http",
  );
}
