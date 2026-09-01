import type { Context } from "@deepseek-ai/cordis";
// Import needed only so `@deepseek-ai/cordis`'s `Context.amibaConnectors`
// augmentation (declared inside dsh-plugin-connector-core) is loaded — this
// plugin otherwise only calls `ctx.amibaConnectors.registerProvider(...)`.
import type {} from "@amiba/dsh-plugin-connector-core";

import { createDingtalkProvider } from "./provider.js";

export * from "./provider.js";
export * from "./translate.js";

export const name = "amiba-connector-dingtalk";
export const inject = ["amibaConnectors"];

/**
 * Registers the DingTalk `ConnectorProvider` with the connector center.
 * No config of its own — every setting lives per-connect, validated by the
 * provider itself via `dingtalkConfigSchema`.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.amibaConnectors.registerProvider(createDingtalkProvider()),
    "amiba-connector-dingtalk.provider",
  );
}
