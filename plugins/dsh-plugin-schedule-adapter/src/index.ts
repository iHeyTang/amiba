import type { Context } from "@deepseek-ai/cordis";

import { applyScheduleNotifications } from "./notify.js";

export const name = "amiba-schedule-adapter";
export const inject: string[] = [];

/**
 * Bridge from the official `@deepseek-ai/dsh-schedule` reminders to Amiba's
 * notification hub — and nothing else.
 *
 * The reminder is an AGENT capability: the model creates one mid-conversation
 * ("I've started the deploy; check back in ten minutes"), the engine queues a
 * follow-up turn in that same session when it fires, and the model lists or
 * deletes reminders through its own tools when asked. Every management face
 * this plugin once carried on top of that — dashboard page, create dialog,
 * `amibaSchedules` remote, token-gated HTTP route, the resume-an-agent
 * manager — existed to serve a UI that duplicated conversation-native
 * behavior, and was deleted with it. What remains is the one thing the
 * conversation cannot do: surface a fired reminder as a desktop
 * notification when the user is looking elsewhere.
 */
export function apply(ctx: Context): void {
  applyScheduleNotifications(ctx);
}
