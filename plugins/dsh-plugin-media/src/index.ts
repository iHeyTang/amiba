import { MediaPreferences } from './preferences.js';
import { MediaRemote } from './remote-service.js';
import type { Context } from "@deepseek-ai/cordis";
import z from '@deepseek-ai/schemastery';
import { MediaService } from './service.js';
import { MediaStore } from './store.js';
import { registerMediaTools } from './tools.js';
export * from "./contracts.js";
export { MediaRegistry } from "./registry.js";
export const name = "amiba-media";
export const inject = ['tools', 'jobs', 'systemPrompt', 'amibaToolCatalog', 'settings', 'userQuestions'];
export interface Config { root: string }
export const Config: z<Config> = z.object({ root: z.string().required() });
declare module "@deepseek-ai/cordis" { interface Context { amibaMedia: MediaService } }
export function apply(ctx: Context, config: Config): void {
  const media = new MediaService(ctx, new MediaStore(config.root), new MediaPreferences(ctx));
  ctx.provide("amibaMedia", media);
  registerMediaTools(ctx, media);
  new MediaRemote(ctx, media);
}
