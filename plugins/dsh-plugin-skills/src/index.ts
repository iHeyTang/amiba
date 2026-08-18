import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import { applySkillsRemote } from "./remote-service.js";
import { AmibaSkillStore } from "./skill-store.js";

export * from "./skill-store.js";

export const name = "amiba-skills";
export const inject = [
  "skills",
  "agents",
  "sessions",
  "sessionPersistence",
  "agentPresets",
  "fs",
];

export interface Config {
  /** User-authored DSH skill root, normally $DSH_HOME/skills. */
  root: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
});

/** Mount the Amiba authoring/UI face on top of the official ctx.skills registry. */
export function apply(ctx: Context, config: Config): void {
  applySkillsRemote(ctx, new AmibaSkillStore(ctx, config.root));
}
