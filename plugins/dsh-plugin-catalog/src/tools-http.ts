import type AgentPresets from "@deepseek-ai/dsh-agent-presets";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-tools";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ToolProvenanceRegistry } from "./provenance.js";

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
  const schemas = new Map(
    ctx.tools.schemas().map((schema) => [schema.name, schema]),
  );
  const presets = (await catalogCtx.agentPresets.list())
    .filter((preset) => !preset.broken)
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const preset of presets) {
    const scope = await catalogCtx.agentPresets.standingKeyFor(preset.id);
    for (const schema of ctx.tools.schemas(scope)) {
      if (!schemas.has(schema.name)) schemas.set(schema.name, schema);
    }
  }

  return {
    tools: [...schemas.values()]
      .map((schema) => ({
        name: schema.name,
        description: schema.description,
        parameters: schema.parameters,
        source: provenance.resolve(schema.name),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
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
