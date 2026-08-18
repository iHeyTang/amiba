import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applyCommandsHttp } from "./http.js";
import { applyCommandsRemote } from "./remote-service.js";

export const name = "amiba-commands-adapter";
export const inject = ["commands", "agents"];

export interface Config {
  apiToken: string;
}

export const Config: z<Config> = z.object({
  apiToken: z.string().default(""),
});

/** Desktop UI adapter for commands registered in the DSH command service. */
export function apply(ctx: Context, config: Config): void {
  applyCommandsRemote(ctx);
  if (config.apiToken) {
    ctx.inject(["webServer"], (httpCtx) => {
      applyCommandsHttp(httpCtx, config);
    });
  }
}
