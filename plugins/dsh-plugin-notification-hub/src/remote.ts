import { z } from "zod";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import {
  cursorSchema,
  updateSchema,
  sessionReadsSchema,
  type NotificationCursor,
  type NotificationUpdate,
  type SessionRead,
} from "./model.js";
export interface NotificationRemote {
  watch(
    after: NotificationCursor | null,
    subscriber: string,
  ): Promise<RemoteResult<NotificationUpdate>>;
  cancelWatch(subscriber: string): Promise<RemoteResult<boolean>>;
  dismiss(id: string): Promise<RemoteResult<boolean>>;
  markSessionsRead(reads: SessionRead[]): Promise<RemoteResult<boolean>>;
}
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaNotifications: NotificationRemote;
  }
  interface TypertRemoteMap {
    "amibaNotifications/watch": NotificationRemote["watch"];
    "amibaNotifications/cancelWatch": NotificationRemote["cancelWatch"];
    "amibaNotifications/dismiss": NotificationRemote["dismiss"];
    "amibaNotifications/markSessionsRead": NotificationRemote["markSessionsRead"];
  }
}
function descriptor(
  method: string,
  parameters: [string, z.ZodType][],
  result: z.ZodType,
): TypertRemoteContribution["descriptors"][number] {
  return {
    id: `@amiba/dsh-plugin-notification-hub#amibaNotifications/${method}`,
    service: "amibaNotificationsRemote",
    namespace: "amibaNotifications",
    method,
    invocation: { kind: "direct" },
    parameters: parameters.map(([name, schema]) => ({
      name,
      wire: name,
      source: "json",
      codec: {
        mode: "strict",
        typeSymbol: `amiba/notifications#${name}`,
        schema,
      },
    })),
    result: {
      mode: "strict",
      typeSymbol: `amiba/notifications#${method}-result`,
      schema: result,
    },
  };
}
export const NOTIFICATION_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-notification-hub",
  descriptors: [
    descriptor(
      "watch",
      [
        ["after", cursorSchema.nullable()],
        ["subscriber", z.string().min(1).max(100)],
      ],
      updateSchema,
    ),
    descriptor(
      "cancelWatch",
      [["subscriber", z.string().min(1).max(100)]],
      z.boolean(),
    ),
    descriptor("dismiss", [["id", z.string().min(1)]], z.boolean()),
    descriptor(
      "markSessionsRead",
      [["reads", sessionReadsSchema]],
      z.boolean(),
    ),
  ],
};
