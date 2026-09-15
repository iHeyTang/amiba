import { useEffect } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionRead } from "../model.js";
import type {} from "@amiba/extension-sdk";
import { NOTIFICATION_REMOTE } from "../remote.js";
import { createNotificationClient, type NotificationClient } from "./store.js";
export type { NotificationClient } from "./store.js";
declare module "@deepseek-ai/cordis" {
  interface Context {
    amibaNotificationFeed: NotificationClient;
  }
}
export const name = "amiba-notification-client";
export const inject = ["remote", "slots"];
function SessionReadObserver({
  readStates,
  feed,
}: {
  readStates: SessionRead[];
  feed: NotificationClient;
}) {
  useEffect(() => {
    feed.markSessionsRead(readStates);
  }, [readStates, feed]);
  return null;
}
export async function apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(NOTIFICATION_REMOTE);
  const fiber = ctx.inject(["remote.amibaNotifications", "slots"], (c) => {
    const feed = createNotificationClient(c.remote.amibaNotifications);
    c.provide("amibaNotificationFeed", feed);
    const offReset = c.on("connection/reset", () => feed.resync());
    const offSlot = c.slots.inject("amiba.session.observer", () =>
      c.slots.register(
        {
          name: "amiba.session.observer",
          id: "notification-read-sync",
          inject: () => ({ feed }),
        },
        SessionReadObserver,
      ),
    );
    c.effect(
      () => () => {
        offSlot();
        offReset();
        feed.dispose();
      },
      "notification-client",
    );
  });
  ctx.effect(
    () => () => {
      fiber.dispose();
      unmount();
    },
    "notification-remotes",
  );
}
