import type { Context } from "@deepseek-ai/cordis"
import type { Context as ClientContext } from "@deepseek-ai/cordis";

export interface AmibaDshPlugin<Config = unknown> {
  name: string
  inject?: readonly string[]
  apply(ctx: Context, config: Config): void | Promise<void>
}

export interface AmibaDshClientPlugin {
  name: string
  inject?: readonly string[]
  apply(ctx: ClientContext): void | Promise<void>
}

/** Type-only authoring helper; DSH/Cordis remains the runtime and loader. */
export function defineDshPlugin<Config>(
  plugin: AmibaDshPlugin<Config>,
): AmibaDshPlugin<Config> {
  return plugin
}

/** Type-only helper for the optional DSH Web Shell half of a plugin. */
export function defineDshClientPlugin(
  plugin: AmibaDshClientPlugin,
): AmibaDshClientPlugin {
  return plugin
}
