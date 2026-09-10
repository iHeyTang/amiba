import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { DshMcpManager, type ManagedMcpServer } from "./manager.js";
import { applyMcpRemote } from "./remote-service.js";
import { applyMcpHttp } from "./supervisor.js";

export const name = "amiba-mcp-manager";
export const inject = ["tools", "amibaToolCatalog"];

export interface Config {
  apiToken: string;
  root: string;
}

export const Config: z<Config> = z.object({
  apiToken: z.string().default(""),
  root: z.string().required(),
});

export type { ManagedMcpServer };
export * from "./dependencies.js";
export * from "./dependency-binding.js";
export * from "./plugin-dependency.js";
export * from "./access.js";
export * from "./provider-connection.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaMcpManager: DshMcpManager;
  }
}

/** Mounts official DSH MCP client plugin instances from Amiba's product MCP configuration. */
export function apply(ctx: Context, config: Config): void {
  const manager = new DshMcpManager(ctx, config.root, ctx.amibaToolCatalog);
  ctx.provide("amibaMcpManager", manager);
  ctx.effect(() => () => manager.dispose(), "amiba-mcp-manager");
  applyMcpRemote(ctx, manager);
  if (config.apiToken) {
    ctx.inject(["webServer"], (httpCtx) => {
      applyMcpHttp(httpCtx, config, ctx.amibaToolCatalog, manager);
    });
  }
}
