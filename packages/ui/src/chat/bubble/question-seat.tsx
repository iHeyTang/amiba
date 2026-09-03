import type { AmibaConversationQuestionOwner } from "@amiba/extension-sdk";
import type { ReactNode } from "react";

/**
 * One dispatch of the `amiba.conversation.question` seat: the owner share
 * plus the banner the host falls back to.
 *
 * `fallback` is the seat's whole visual-parity guarantee. It is Amiba's own
 * `ClarifyBanner`, already built; the host hands it to `renderSlot`'s
 * `fallback` option, so a question id no plugin registered renders EXACTLY
 * what it rendered before the seat existed, and a registered id replaces
 * only that one question's screen.
 */
export interface QuestionSeatRequest {
  owner: AmibaConversationQuestionOwner;
  fallback: ReactNode;
}

/**
 * The host's renderSlot-backed dispatch, keyed by the first pending
 * question's id —
 * `renderSlot("amiba.conversation.question", request.owner, { entryKey:
 * request.owner.request.questions[0]?.id ?? "", fallback: request.fallback })`
 * — so the conversation footer itself holds no slot knowledge.
 */
export type QuestionSeatRenderer = (request: QuestionSeatRequest) => ReactNode;

/**
 * Renders the claimed screen when a renderer exists, else the fallback — so
 * an unclaimed question looks exactly as before.
 *
 * @param props.owner - the owner share of the pending question request.
 * @param props.fallback - the host's built-in banner for this request.
 * @param props.render - the host's dispatch, absent outside a plugin runtime.
 * @returns the dispatch result, or the fallback.
 */
export function QuestionSeat({
  owner,
  fallback,
  render,
}: QuestionSeatRequest & { render?: QuestionSeatRenderer }) {
  return <>{render ? render({ owner, fallback }) : fallback}</>;
}
