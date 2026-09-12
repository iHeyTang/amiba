import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import {
  cursorSchema,
  sessionReadsSchema,
  type NotificationCursor,
  type SessionRead,
} from "./model.js";
import type { AmibaNotificationHub } from "./hub.js";
export class NotificationRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private hub: AmibaNotificationHub,
  ) {
    super(ctx, "amibaNotificationsRemote", { namespace: "amibaNotifications" });
  }
  @Remote watch(after: NotificationCursor | null, subscriber: string) {
    if (
      typeof subscriber !== "string" ||
      !subscriber ||
      subscriber.length > 100
    )
      throw new Error("Invalid subscriber");
    return this.hub.watch(cursorSchema.nullable().parse(after), subscriber);
  }
  @Remote cancelWatch(subscriber: string) {
    this.hub.cancelWatch(subscriber);
    return true;
  }
  @Remote dismiss(id: string) {
    this.hub.dismiss(id);
    return true;
  }
  @Remote markSessionsRead(reads: SessionRead[]) {
    this.hub.markSessionsRead(sessionReadsSchema.parse(reads));
    return true;
  }
}
