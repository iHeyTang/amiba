import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { VisionCatalog } from "./catalog.js";
import { VisionPreferences } from "./preferences.js";
import { VisionRemote } from "./remote-service.js";
import { registerVisionTools } from "./tools.js";

export * from "./contracts.js";
export { VisionCatalog } from "./catalog.js";
export { VisionPreferences } from "./preferences.js";
export const name = "amiba-vision";
export const inject = [
  "tools",
  "llm",
  "attachments",
  "settings",
  "systemPrompt",
  "amibaToolCatalog",
];
export interface Config {}
export const Config: z<Config> = z.object({});
export function apply(ctx: Context, _config: Config): void {
  const preferences = new VisionPreferences(ctx);
  const catalog = new VisionCatalog(ctx, preferences);
  registerVisionTools(ctx, catalog);
  new VisionRemote(ctx, catalog, preferences);
}
