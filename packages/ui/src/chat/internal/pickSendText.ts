/**
 * Single source of truth for "which text actually gets dispatched/queued
 * when the composer submits".
 *
 * The Composer expands `@[type:payload]` mention tokens into agent-facing
 * text at send time and passes the RESULT to `onSubmit(finalText)`. Every
 * consumer (ChatView, ChatSurface→usePendingQueue, HomeView) must dispatch
 * THAT expanded text — not re-read the raw composer input, which still
 * contains the un-expanded `@[...]` tokens.
 *
 * This helper encodes the "prefer the passed (expanded) override, else fall
 * back to the raw input" rule + trimming in one place so the rule can be
 * unit-tested without rendering the whole composer stack.
 *
 * NOTE: this intentionally returns the TRIMMED text to dispatch. It does not
 * decide whether the send is allowed (attachment-only sends, busy/queue
 * routing) — callers keep that logic; they only use this for the payload.
 */
export function pickSendText(override: string | undefined, rawInput: string): string {
  return (override ?? rawInput).trim()
}
