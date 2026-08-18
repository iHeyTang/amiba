import type { Context } from "@deepseek-ai/cordis";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import type {} from "@amiba/dsh-plugin-notification-hub";

/**
 * Desktop notification for fired schedules.
 *
 * The official `@deepseek-ai/dsh-schedule` runtime wakes a due schedule by
 * appending a `schedule/change { operation: "dispatch" }` event to the
 * owning session (and following up the reminder prompt into the agent).
 * That append is publicly observable on the `session/event` firehose, so
 * this adapter watches for dispatches and posts a notification into the
 * provider-neutral hub (`ctx.amibaNotifications`) — the adapter never
 * duplicates schedule state and Electron is never called directly.
 */

const TITLE_LIMIT = 120;

/** What this consumer posts; mirrors `AmibaNotificationInput` (subset). */
export interface ScheduleNotificationPost {
  title: string;
  kind: "info";
  sessionId: string;
  source: string;
}

function compact(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function changeRecord(event: {
  type: string;
  data: unknown;
}): Record<string, unknown> | undefined {
  if (event.type !== "schedule/change") return undefined;
  const data = event.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : undefined;
}

/** Find the creating record's prompt for one dispatched schedule id. */
export function schedulePromptOf(
  events: readonly { type: string; data: unknown }[],
  dispatchId: string,
): string | undefined {
  let prompt: string | undefined;
  for (const event of events) {
    const change = changeRecord(event);
    if (!change || change.operation !== "create") continue;
    const schedule = change.schedule;
    if (!schedule || typeof schedule !== "object") continue;
    const record = schedule as Record<string, unknown>;
    if (record.id !== dispatchId) continue;
    if (typeof record.prompt === "string") prompt = record.prompt;
  }
  return prompt;
}

/**
 * Build the `session/event` listener. Extracted so tests can drive it with
 * a mock `post` without standing up a Cordis runtime.
 */
export function scheduleDispatchListener(
  post: (input: ScheduleNotificationPost) => unknown,
  warn: (message: string) => void,
): (session: Session, event: SessionEvent) => void {
  return (session, event) => {
    const change = changeRecord(event);
    if (!change || change.operation !== "dispatch") return;
    const dispatchId = change.id;
    if (typeof dispatchId !== "string") return;
    const title = compact(
      schedulePromptOf(session.events, dispatchId) ?? "",
      TITLE_LIMIT,
    );
    if (!title) return;
    try {
      post({
        title,
        kind: "info",
        sessionId: String(session.id),
        source: "schedule-adapter",
      });
    } catch (error) {
      warn(`schedule notification post failed: ${String(error)}`);
    }
  };
}

/**
 * Attach the fired-schedule notification consumer. Guarded injection: the
 * adapter still composes (and all management faces keep working) on a
 * runtime without the notification hub.
 */
export function applyScheduleNotifications(ctx: Context): void {
  ctx.inject(["amibaNotifications"], (hubCtx) => {
    hubCtx.on(
      "session/event",
      scheduleDispatchListener(
        (input) => hubCtx.amibaNotifications.post(input),
        (message) => hubCtx.logger.warn(`amiba-schedule-adapter: ${message}`),
      ),
    );
  });
}
