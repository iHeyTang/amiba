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
 * Stops a bubble spinning without otherwise touching it — used when the
 * engine settles a HOST-started run that a local submit displaced.
 *
 * Deliberately not the `[stopped]` seal `markCurrentAssistantStopped`
 * applies: the displaced turn was not cancelled, it is still running on the
 * host and the next history read returns it complete. Marking partial text
 * as stopped would be a claim that disappears on reload.
 */
export function settleStreamingMessage(
  messages: readonly UiMessage[],
  assistantUiId: string,
): UiMessage[] {
  const index = messages.findIndex(
    (message) => message.uiId === assistantUiId && message.streaming,
  );
  if (index < 0) return messages as UiMessage[];
  const next = (messages as UiMessage[]).slice();
  next[index] = { ...next[index]!, streaming: false };
  return next;
}

/**
 * Appends a user-role message the host put into the session (a plugin
 * dispatching on the user's behalf), carrying its `origin` so the bubble can
 * say who it came from and its `notice` so an ACCOUNT of something that
 * happened (a steward task report) renders as a collapsed row instead of the
 * person's own words. The person's own messages never arrive this way — the
 * composer has already appended them.
 */
export function withHostUserMessage(
  messages: readonly UiMessage[],
  message: {
    uiId: string;
    content: string;
    images?: ChatMessage["images"];
    attachments?: UiMessage["attachments"];
    attachmentBadges?: UiMessage["attachmentBadges"];
    sentAt?: number;
    origin?: ChatMessage["origin"];
    notice?: ChatMessage["notice"];
  },
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
      ...(message.images?.length ? { images: message.images } : {}),
      ...(message.attachments?.length ? { attachments: message.attachments } : {}),
      ...(message.attachmentBadges?.length ? { attachmentBadges: message.attachmentBadges } : {}),
      ...(message.sentAt !== undefined ? { sentAt: message.sentAt } : {}),
      ...(message.origin ? { origin: message.origin } : {}),
      ...(message.notice ? { notice: message.notice } : {}),
    },
  ];
}

/** Locate the same assistant across durable history IDs and transient engine IDs.
 * Content is deliberately not an identity: consecutive turns may be identical.
 */
export function findSnapshotAssistant(
  messages: readonly UiMessage[],
  snapshot: { assistantUiId?: string | null; assistantMessageId?: string; runtimeTurn?: number },
): number {
  const exact = messages.findIndex(message => message.role === "assistant" && message.uiId === snapshot.assistantUiId);
  if (exact >= 0) return exact;
  return messages.findIndex(message => message.role === "assistant" && (
    (!!snapshot.assistantMessageId && message.assistantMessageId === snapshot.assistantMessageId) ||
    (Number.isSafeInteger(snapshot.runtimeTurn) && snapshot.runtimeTurn! >= 0 && message.runtimeTurn === snapshot.runtimeTurn)
  ));
}
