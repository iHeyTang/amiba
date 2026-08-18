import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

import {
  AmibaRuntimeGatewayClient,
  type RuntimeGatewayConfig,
} from "./bridge.js";

export * from "./bridge.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaRuntimeGateway: AmibaRuntimeGatewayClient;
  }
}

export const name = "amiba-runtime-gateway";

export type Config = RuntimeGatewayConfig;

export const Config: z<Config> = z.object({
  url: z.string().required(),
  token: z.string().required(),
});

/** Authenticated transport service; it owns no model-facing tool schema. */
export function apply(ctx: Context, config: Config): void {
  ctx.provide("amibaRuntimeGateway", new AmibaRuntimeGatewayClient(config));
}
