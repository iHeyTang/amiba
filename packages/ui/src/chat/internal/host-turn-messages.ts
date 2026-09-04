/**
 * The two message-list edits a HOST-started turn needs — a turn a plugin
 * kicked off, which no local `runChatTurn` prepared the conversation for.
 *
 * Both are idempotent on `uiId` and return the SAME array when there is
 * nothing to add, so they are safe to run on every event and cost a render
 * only when the list actually changed. That matters because the ids are
 * stable across sources: the live mux bridge derives a plugin message's
 * `uiId` exactly as the durable-log projection does, so an event that races
 * a history re-read (a tab switch mid-turn) is a no-op rather than a second
 * bubble.
 */

import type { ChatMessage } from "@amiba/app-runtime/core";

import type { UiMessage } from "./types";

/**
 * Ensures the streaming assistant bubble a `begin` refers to exists.
 *
 * A locally submitted turn appends its placeholder before it submits, so
 * this finds it and does nothing. A host-started turn has none, and the
 * stream buffer's flushes only ever UPDATE an existing bubble — without
 * this the reply would stream into a message that was never there.
 */
export function withHostAssistantPlaceholder(
  messages: readonly UiMessage[],
  assistantUiId: string,
): UiMessage[] {
  if (messages.some((message) => message.uiId === assistantUiId)) {
    return messages as UiMessage[];
  }
  return [
    ...messages,
    { uiId: assistantUiId, role: "assistant", content: "", streaming: true },
  ];
}

/**
 * Appends a user message the host put into the session (a plugin dispatching
 * on the user's behalf), carrying its `origin` so the bubble can say who it
 * came from. The person's own messages never arrive this way — the composer
 * has already appended them.
 */
export function withHostUserMessage(
  messages: readonly UiMessage[],
  message: { uiId: string; content: string; origin?: ChatMessage["origin"] },
): UiMessage[] {
  if (messages.some((existing) => existing.uiId === message.uiId)) {
    return messages as UiMessage[];
  }
  return [
    ...messages,
    {
      uiId: message.uiId,
      role: "user",
      content: message.content,
      ...(message.origin ? { origin: message.origin } : {}),
    },
  ];
}
