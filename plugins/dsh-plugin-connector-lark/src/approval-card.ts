/**
 * Lark/Feishu interactive-card (schema "2.0") builders for the tool-approval
 * flow (`.worktable/im-approval/plan.md` §4). Pure functions only — no SDK
 * dependency, no I/O — so they are trivially unit-testable and so
 * `provider.ts` can call them from both `requestApproval` (ask) and
 * `announceApprovalOutcome` (settle) without threading the SDK's own types
 * through this module.
 *
 * The prompt/notice shapes below are STRUCTURAL MIRRORS of messaging-core's
 * `ApprovalPrompt`/`ApprovalOutcomeNotice` (see
 * `.worktable/im-approval/task-1-report.md` §2) — this package intentionally
 * does not depend on `@amiba/dsh-plugin-messaging-core` (connector-core is
 * the only plugin that bridges to it; a provider only ever receives values
 * that are ALREADY typed as `ApprovalPrompt`/`ApprovalOutcomeNotice` by
 * `ConnectorRuntime`'s own signature in `provider.ts`, so no import is
 * needed there either — TypeScript checks the call sites structurally
 * against the interfaces declared here). Same mirroring convention
 * messaging-core itself uses for dsh-user-approval's `ApprovalOutcome`.
 */

/** The subset of Lark card v2 fields these builders emit; callers pass the
 * result straight to `ApiLike.sendInteractiveCard`/`updateInteractiveCard`,
 * which only need `object`. */
export type LarkApprovalCard = Record<string, unknown>;

export type ApprovalDecision = "allowed-once" | "rejected";
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable";
export type ApprovalSettlementReason = "answered" | "timeout" | "desktop" | "cancelled";

export interface ApprovalCardPrompt {
  readonly approvalId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly reason?: string;
}

export interface ApprovalCardNotice {
  readonly approvalId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly outcome: ApprovalOutcome;
  readonly reason: ApprovalSettlementReason;
}

/** The button `value` payload — round-tripped through `translateCardAction`. */
export interface ApprovalCardActionValue {
  approvalId: string;
  decision: ApprovalDecision;
}

function plainText(content: string): { tag: "plain_text"; content: string } {
  return { tag: "plain_text", content };
}

function askBody(prompt: ApprovalCardPrompt): string {
  const head = `#${prompt.seq} · ${prompt.toolName}`;
  return prompt.reason ? `${head}\n${prompt.reason}` : head;
}

/**
 * The initial ask card: header「需要你的审批」, the tool/reason body, and two
 * buttons whose `value` carries `{ approvalId, decision }` — read back by
 * `translateCardAction` once Lark posts the click.
 */
export function buildApprovalCard(prompt: ApprovalCardPrompt): LarkApprovalCard {
  const approveValue: ApprovalCardActionValue = {
    approvalId: prompt.approvalId,
    decision: "allowed-once",
  };
  const rejectValue: ApprovalCardActionValue = {
    approvalId: prompt.approvalId,
    decision: "rejected",
  };
  return {
    schema: "2.0",
    header: {
      title: plainText("需要你的审批"),
      template: "blue",
    },
    body: {
      elements: [
        { tag: "markdown", content: askBody(prompt) },
        {
          tag: "action",
          actions: [
            {
              tag: "button",
              text: plainText("同意"),
              type: "primary",
              value: approveValue,
            },
            {
              tag: "button",
              text: plainText("拒绝"),
              type: "danger",
              value: rejectValue,
            },
          ],
        },
      ],
    },
  };
}

/** Plan §4/§5 status copy, keyed by settlement reason first (it is more
 * specific than outcome — a timeout is always a rejection, but not every
 * rejection is a timeout) and outcome only for the plain answered case. */
function statusLabel(notice: ApprovalCardNotice): string {
  switch (notice.reason) {
    case "timeout":
      return "已超时拒绝";
    case "desktop":
      return "已在桌面处理";
    case "cancelled":
      return "已取消";
    case "answered":
      return notice.outcome === "allowed-once" ? "已同意" : "已拒绝";
  }
}

/** Header accent: green once actually allowed, red for an explicit or timed
 * out rejection, grey for anything that closed without a decision. */
function statusTemplate(notice: ApprovalCardNotice): string {
  if (notice.reason === "answered" && notice.outcome === "allowed-once") return "green";
  if (notice.outcome === "rejected") return "red";
  return "grey";
}

/**
 * The settled-card variant: no buttons (the question is closed), header
 * accent + a status line replacing the ask body.
 */
export function buildSettledCard(notice: ApprovalCardNotice): LarkApprovalCard {
  return {
    schema: "2.0",
    header: {
      title: plainText("审批结果"),
      template: statusTemplate(notice),
    },
    body: {
      elements: [
        {
          tag: "markdown",
          content: `#${notice.seq} · ${notice.toolName}\n${statusLabel(notice)}`,
        },
      ],
    },
  };
}
