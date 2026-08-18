/**
 * Pure helpers for the plugin-posted heads-up notification operation.
 *
 * DSH plugins post into the runtime's notification hub
 * (`ctx.amibaNotifications`); the runtime-gateway plugin forwards each
 * notification to Electron main over the authenticated native gateway as
 * the `amiba_notify` operation handled here. Electron stays a delivery
 * surface: it validates the payload and renders it, owning no notification
 * domain logic.
 */

import type { DshNativeOperation } from "./dsh-native-gateway";

/** Operation name; must match `NOTIFY_OPERATION` in dsh-plugin-runtime-gateway. */
export const PLUGIN_NOTIFY_OPERATION = "amiba_notify";

export type PluginNotificationKind = "info" | "success" | "warning" | "error";

export interface PluginNotifierMessage {
  type: "plugin";
  id: string;
  title: string;
  body?: string;
  kind: PluginNotificationKind;
  sessionId?: string;
  source: string;
  timestamp: number;
}

const KINDS: ReadonlySet<string> = new Set([
  "info",
  "success",
  "warning",
  "error",
]);

const TITLE_MAX = 120;
const BODY_MAX = 300;
const SOURCE_MAX = 64;

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}

/** Validate and normalize one `amiba_notify` payload into a notifier card. */
export function parsePluginNotification(
  args: Record<string, unknown>,
): PluginNotifierMessage {
  const title = compact(requiredString(args, "title"), TITLE_MAX);
  const source = compact(requiredString(args, "source"), SOURCE_MAX);
  const body = optionalString(args, "body");
  const kindValue = optionalString(args, "kind");
  const sessionId = optionalString(args, "sessionId");
  const id = optionalString(args, "id") ?? `plugin_${Date.now()}`;
  const timestamp =
    typeof args.timestamp === "number" && Number.isFinite(args.timestamp)
      ? args.timestamp
      : Date.now();
  return {
    type: "plugin",
    id,
    title,
    ...(body === undefined ? {} : { body: compact(body, BODY_MAX) }),
    kind:
      kindValue !== undefined && KINDS.has(kindValue)
        ? (kindValue as PluginNotificationKind)
        : "info",
    ...(sessionId === undefined ? {} : { sessionId }),
    source,
    timestamp,
  };
}

/** The native gateway operation delivering plugin notifications to the notifier. */
export function pluginNotificationOperation(
  deliver: (message: PluginNotifierMessage) => void,
): DshNativeOperation {
  return {
    name: PLUGIN_NOTIFY_OPERATION,
    call(argumentsValue) {
      const message = parsePluginNotification(argumentsValue);
      deliver(message);
      return { delivered: true, id: message.id };
    },
  };
}
