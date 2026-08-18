import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import type {} from "@amiba/dsh-plugin-notification-hub";

import {
  AmibaRuntimeGatewayClient,
  type RuntimeGatewayConfig,
} from "./bridge.js";
import { desktopNotificationSink } from "./notifications.js";

export * from "./bridge.js";
export * from "./notifications.js";

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
  const client = new AmibaRuntimeGatewayClient(config);
  ctx.provide("amibaRuntimeGateway", client);

  // Desktop delivery sink for the provider-neutral notification hub. The
  // hub lives in the Core bundle, so guard the injection: on a runtime
  // composed without it, the gateway still provides plain transport.
  ctx.inject(["amibaNotifications"], (hubCtx) => {
    hubCtx.effect(
      () =>
        hubCtx.amibaNotifications.registerSink(
          desktopNotificationSink(client, (message) =>
            hubCtx.logger.warn(`amiba-runtime-gateway: ${message}`),
          ),
        ),
      "amiba-runtime-gateway.notification-sink",
    );
  });
}
