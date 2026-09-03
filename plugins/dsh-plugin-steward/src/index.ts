import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

export * from "./types.js";

export const name = "amiba-steward";
export const inject: string[] = [];

export interface Config {
  root: string;
  agentPresetsRoot: string;
  defaultCwd?: string;
  taskPreset?: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  agentPresetsRoot: z.string().required(),
  defaultCwd: z.string(),
  taskPreset: z.string(),
});

export function apply(_ctx: Context, _config: Config): void {}
