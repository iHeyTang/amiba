import { describe, expect, it } from "vitest";

import {
  buildApprovalCard,
  buildSettledCard,
  type ApprovalCardNotice,
  type ApprovalCardPrompt,
} from "./approval-card.js";

const prompt: ApprovalCardPrompt = {
  approvalId: "amiba-approval-1",
  seq: 2,
  toolName: "shell.exec",
  reason: "rm -rf /tmp/cache",
};

describe("buildApprovalCard", () => {
  it("titles the header 需要你的审批", () => {
    const card = buildApprovalCard(prompt) as any;
    expect(card.schema).toBe("2.0");
    expect(card.header.title).toEqual({ tag: "plain_text", content: "需要你的审批" });
  });

  it("bodies the seq/tool name and reason as markdown", () => {
    const card = buildApprovalCard(prompt) as any;
    const [markdown] = card.body.elements;
    expect(markdown).toEqual({
      tag: "markdown",
      content: "#2 · shell.exec\nrm -rf /tmp/cache",
    });
  });

  it("omits the reason line when the prompt has none", () => {
    const card = buildApprovalCard({ ...prompt, reason: undefined }) as any;
    const [markdown] = card.body.elements;
    expect(markdown.content).toBe("#2 · shell.exec");
  });

  it("carries two buttons whose value is { approvalId, decision }", () => {
    const card = buildApprovalCard(prompt) as any;
    const [, actionElement] = card.body.elements;
    expect(actionElement.tag).toBe("action");
    expect(actionElement.actions).toEqual([
      {
        tag: "button",
        text: { tag: "plain_text", content: "同意" },
        type: "primary",
        value: { approvalId: "amiba-approval-1", decision: "allowed-once" },
      },
      {
        tag: "button",
        text: { tag: "plain_text", content: "拒绝" },
        type: "danger",
        value: { approvalId: "amiba-approval-1", decision: "rejected" },
      },
    ]);
  });
});

describe("buildSettledCard", () => {
  function notice(overrides: Partial<ApprovalCardNotice>): ApprovalCardNotice {
    return {
      approvalId: "amiba-approval-1",
      seq: 2,
      toolName: "shell.exec",
      outcome: "allowed-once",
      reason: "answered",
      ...overrides,
    };
  }

  it("never renders buttons", () => {
    const card = buildSettledCard(notice({})) as any;
    expect(card.body.elements).toHaveLength(1);
    expect(card.body.elements[0].tag).toBe("markdown");
  });

  it.each<[ApprovalCardNotice, string]>([
    [notice({ outcome: "allowed-once", reason: "answered" }), "已同意"],
    [notice({ outcome: "rejected", reason: "answered" }), "已拒绝"],
    [notice({ outcome: "rejected", reason: "timeout" }), "已超时拒绝"],
    [notice({ outcome: "unavailable", reason: "desktop" }), "已在桌面处理"],
    [notice({ outcome: "cancelled", reason: "cancelled" }), "已取消"],
  ])("maps %o to %s", (input, expected) => {
    const card = buildSettledCard(input) as any;
    expect(card.body.elements[0].content).toContain(expected);
  });

  it("includes the seq and tool name in the status line", () => {
    const card = buildSettledCard(notice({})) as any;
    expect(card.body.elements[0].content).toBe("#2 · shell.exec\n已同意");
  });

  it("accents green only for an actual approval, red for any rejection, grey otherwise", () => {
    expect(
      (buildSettledCard(notice({ outcome: "allowed-once", reason: "answered" })) as any)
        .header.template,
    ).toBe("green");
    expect(
      (buildSettledCard(notice({ outcome: "rejected", reason: "answered" })) as any).header
        .template,
    ).toBe("red");
    expect(
      (buildSettledCard(notice({ outcome: "rejected", reason: "timeout" })) as any).header
        .template,
    ).toBe("red");
    expect(
      (buildSettledCard(notice({ outcome: "cancelled", reason: "cancelled" })) as any).header
        .template,
    ).toBe("grey");
    expect(
      (buildSettledCard(notice({ outcome: "unavailable", reason: "desktop" })) as any).header
        .template,
    ).toBe("grey");
  });
});
