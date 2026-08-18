import type { AmibaNotification } from "@amiba/dsh-plugin-notification-hub";

import type { AmibaRuntimeGatewayClient } from "./bridge.js";

/**
 * The Electron-main native operation that renders a plugin-posted
 * notification on the desktop heads-up notifier. Must match the operation
 * registered by `apps/desktop/src/main/plugin-notification.ts`.
 */
export const NOTIFY_OPERATION = "amiba_notify";

const NOTIFY_TIMEOUT_MS = 10_000;

/**
 * Build the desktop delivery sink for `ctx.amibaNotifications`.
 *
 * Fire-and-forget by design: a notification is advisory, so a failed or
 * timed-out delivery is logged and dropped instead of failing the poster.
 */
export function desktopNotificationSink(
  client: Pick<AmibaRuntimeGatewayClient, "call">,
  warn: (message: string) => void,
): (notification: AmibaNotification) => void {
  return (notification) => {
    void client
      .call(
        NOTIFY_OPERATION,
        { ...notification },
        AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
      )
      .catch((error) => {
        warn(
          `desktop delivery failed for notification ${notification.id}: ${String(error)}`,
        );
      });
  };
}
