/**
 * Pure presentation mapping for plugin-posted notifier cards.
 *
 * Kept free of React/DOM so the mapping is testable under the desktop's
 * node:test harness. `NotifierView` renders the resulting model with the
 * existing `CardShell`/`NotificationLayout` primitives — plugin cards
 * reuse the two established tones instead of inventing a new visual
 * system: calm kinds (`info`/`success`) present like a completion,
 * attention kinds (`warning`/`error`) present like an approval.
 */

export type PluginNotifierTone = "complete" | "approval";

export interface PluginNotifierCardModel {
  id: string;
  tone: PluginNotifierTone;
  /** Empty string when the payload carried no usable title (caller falls back to i18n). */
  title: string;
  /** Body when present, else the posting plugin's name, else "". */
  status: string;
  sessionId?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Map a raw `type: "plugin"` notifier message into a renderable card model. */
export function presentPluginNotifierCard(message: {
  id?: unknown;
  title?: unknown;
  body?: unknown;
  kind?: unknown;
  sessionId?: unknown;
  source?: unknown;
}): PluginNotifierCardModel {
  const kind = text(message.kind);
  const tone: PluginNotifierTone =
    kind === "warning" || kind === "error" ? "approval" : "complete";
  const sessionId = text(message.sessionId);
  return {
    id: text(message.id) || `plugin_${Date.now()}`,
    tone,
    title: text(message.title),
    status: text(message.body) || text(message.source),
    ...(sessionId ? { sessionId } : {}),
  };
}
