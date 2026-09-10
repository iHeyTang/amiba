import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { ToolProvenanceRegistry } from "./provenance.js";
import { applyToolsHttp } from "./tools-http.js";
import { applyToolsRemote } from "./remote-service.js";

export * from "./provenance.js";

export const name = "amiba-capability-catalog";
export const inject = ["tools", "agentPresets"];

export interface Config {
  apiToken: string;
  shippedBundles: string[];
}

export const Config: z<Config> = z.object({
  apiToken: z.string().default(""),
  shippedBundles: z.array(z.string()).default([]),
});

/**
 * DSH-side catalog of the plugins that own model-facing tools.
 *
 * This is intentionally a Cordis service rather than an Electron-maintained
 * catalog: each DSH plugin records its own registrations and those records
 * unwind with the plugin's lifecycle.
 */
export function apply(ctx: Context, config: Config): void {
  const catalog = new ToolProvenanceRegistry(config.shippedBundles);
  ctx.provide("amibaToolCatalog", catalog);
  applyToolsRemote(ctx, catalog);
  if (config.apiToken) {
    ctx.inject(["webServer"], (httpCtx) => {
      applyToolsHttp(httpCtx, config, catalog);
    });
  }
}
