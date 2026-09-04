import type { DingtalkApprovalDecision } from "./translate.js";

/**
 * Pure builders for the DingTalk approval card's content — no knowledge of
 * how it's actually transported (that's `provider.ts`'s `createCard`/
 * `updateCard` seam) or of any single `approvalId` (the caller stamps that
 * in when it builds the real wire request; two connects racing the SAME
 * `ApprovalPrompt` — which can't happen today, but nothing here assumes it
 * can't — would produce identical content, by design).
 */

/** One of the card's two buttons: its label, and the decision clicking it
 * carries back through `translateCardCallback`'s `params.decision`. */
export interface ApprovalCardButton {
  readonly label: string;
  readonly decision: DingtalkApprovalDecision;
}

/** The pending variant: a question with two buttons. */
export interface ApprovalCardPrompt {
  readonly header: string;
  readonly body: string;
  readonly agree: ApprovalCardButton;
  readonly reject: ApprovalCardButton;
}

/** The settled variant: the same header/body plus a one-line result, no
 * buttons — `provider.ts`'s `announceApprovalOutcome` sends this to
 * `updateCard` once the question is decided by whichever path won. */
export interface ApprovalCardSettled {
  readonly header: string;
  readonly body: string;
  readonly statusLine: string;
}

const CARD_HEADER = "需要你的审批";

function formatBody(seq: number, toolName: string, reason?: string): string {
  const head = `#${seq} · ${toolName}`;
  return reason && reason.trim() !== "" ? `${head}\n${reason}` : head;
}

/** Builds the pending card's content for one `ApprovalPrompt`
 * (`{ seq, toolName, reason? }` — the same shape messaging-core hands
 * `requestApproval`, read structurally here rather than importing the type
 * from `@amiba/dsh-plugin-messaging-core`, which this plugin doesn't
 * depend on). */
export function buildApprovalCardPrompt(prompt: {
  readonly seq: number;
  readonly toolName: string;
  readonly reason?: string;
}): ApprovalCardPrompt {
  return {
    header: CARD_HEADER,
    body: formatBody(prompt.seq, prompt.toolName, prompt.reason),
    agree: { label: "同意", decision: "allowed-once" },
    reject: { label: "拒绝", decision: "rejected" },
  };
}

/**
 * Maps a settled approval's `(outcome, reason)` pair onto the plan's exact
 * status-line copy (§4): 「已同意 / 已拒绝 / 已超时拒绝 / 已在桌面处理 / 已取消」.
 * `reason: "desktop"` is currently unreachable from messaging-core (see
 * task-1-report.md §7.5 — prepending the IM answerer means the desktop
 * backstop never races it today) but is still mapped correctly here rather
 * than falling into the generic "已取消" bucket, so this needs no change if
 * that changes later. `outcome: "unavailable"` isn't in the plan's list at
 * all (a DSH-internal outcome, not one a human or a timeout produces) and
 * falls back to "已取消" as the closest honest description: the question is
 * over and nothing was decided.
 */
function settledStatusLine(
  outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable",
  reason: "answered" | "timeout" | "desktop" | "cancelled",
): string {
  if (outcome === "allowed-once") return "已同意";
  if (outcome === "rejected") return reason === "timeout" ? "已超时拒绝" : "已拒绝";
  if (outcome === "cancelled") return reason === "desktop" ? "已在桌面处理" : "已取消";
  return "已取消";
}

/** Builds the settled card's content for one `ApprovalOutcomeNotice`
 * (read structurally, same reasoning as `buildApprovalCardPrompt` above). */
export function buildApprovalCardSettled(notice: {
  readonly seq: number;
  readonly toolName: string;
  readonly outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
  readonly reason: "answered" | "timeout" | "desktop" | "cancelled";
}): ApprovalCardSettled {
  return {
    header: CARD_HEADER,
    body: formatBody(notice.seq, notice.toolName),
    statusLine: settledStatusLine(notice.outcome, notice.reason),
  };
}
