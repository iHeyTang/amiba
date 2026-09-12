import z from "@deepseek-ai/schemastery";
import type { Context } from "@deepseek-ai/cordis";

import { NotificationRemoteService } from "./remote-service.js";
import { AmibaNotificationHub } from "./hub.js";

export * from "./hub.js";

declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaNotifications: AmibaNotificationHub;
  }
}

export const name = "amiba-notification-hub";
export const inject: string[] = [];

/**
 * Mechanism-only notification infrastructure: the hub owns validation,
 * bounded retention and sink fan-out; posting plugins own the content and
 * delivery plugins own the transport to an actual surface.
 */
export const Config = z.object({ root: z.string() });
export function apply(ctx: Context, config: { root?: string } = {}): void {
  const hub = new AmibaNotificationHub(ctx, config.root);
  ctx.provide("amibaNotifications", hub);
  new NotificationRemoteService(ctx, hub);
  ctx.effect(() => () => hub.dispose(), "notification-center");
}
