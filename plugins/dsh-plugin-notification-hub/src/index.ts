import type { Context } from "@deepseek-ai/cordis";

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
export function apply(ctx: Context): void {
  ctx.provide("amibaNotifications", new AmibaNotificationHub(ctx));
}
