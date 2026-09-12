import { z } from "zod";
export const notificationInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(600).optional(),
  key: z.string().trim().min(1).max(300).optional(),
  status: z.enum(["completed", "failed", "interrupted", "waiting", "thinking", "responding", "tooling"]).optional(),
  kind: z.enum(["info", "success", "warning", "error"]).default("info"),
  sessionId: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(64),
});
export const notificationSchema = notificationInputSchema.extend({
  activity: z.boolean().optional(),
  id: z.string(),
  timestamp: z.number().finite(),
  readAt: z.number().finite().optional(),
  dismissedAt: z.number().finite().optional(),
  resolvedAt: z.number().finite().optional(),
});
export type AmibaNotificationInput = z.input<typeof notificationInputSchema>;
export type AmibaNotification = z.output<typeof notificationSchema>;
export type AmibaNotificationKind = AmibaNotification["kind"];
export const cursorSchema = z.object({
  epoch: z.string(),
  revision: z.number().int().nonnegative(),
});
export type NotificationCursor = z.infer<typeof cursorSchema>;
export const updateSchema = z.object({
  cursor: cursorSchema,
  reset: z.boolean(),
  notifications: z.array(notificationSchema),
  removed: z.array(z.string()),
});
export type NotificationUpdate = z.infer<typeof updateSchema>;
export const sessionReadsSchema = z
  .array(
    z.object({
      sessionId: z.string().min(1).max(200),
      readAt: z.number().int().nonnegative(),
    }),
  )
  .max(1000);
export type SessionRead = z.infer<typeof sessionReadsSchema>[number];
export const isNotificationVisible = (n: AmibaNotification) =>
  !n.activity &&
  n.readAt === undefined &&
  n.dismissedAt === undefined &&
  n.resolvedAt === undefined;
/** An unresolved request is protected even after a user has read or dismissed it. */
export const isNotificationProtected = (n: AmibaNotification) =>
  n.activity === true ||
  isNotificationVisible(n) ||
  (n.status === "waiting" && n.resolvedAt === undefined);

/** Live activity is independent of notification read/dismiss state. */
export const isPetStatusVisible = (n: AmibaNotification) => n.activity ? n.resolvedAt === undefined : isNotificationVisible(n);
