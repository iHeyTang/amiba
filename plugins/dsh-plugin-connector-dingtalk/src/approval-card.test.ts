import { describe, expect, it } from "vitest";

import { buildApprovalCardPrompt, buildApprovalCardSettled } from "./approval-card.js";

describe("buildApprovalCardPrompt", () => {
  it("builds the header, numbered body, and two buttons carrying their own decision", () => {
    const card = buildApprovalCardPrompt({ seq: 2, toolName: "run_shell", reason: "needs sudo" });
    expect(card).toEqual({
      header: "需要你的审批",
      body: "#2 · run_shell\nneeds sudo",
      agree: { label: "同意", decision: "allowed-once" },
      reject: { label: "拒绝", decision: "rejected" },
    });
  });

  it("omits the reason line entirely when no reason is given", () => {
    const card = buildApprovalCardPrompt({ seq: 1, toolName: "read_file" });
    expect(card.body).toBe("#1 · read_file");
  });

  it("omits the reason line when reason is an empty/whitespace-only string", () => {
    expect(buildApprovalCardPrompt({ seq: 3, toolName: "x", reason: "" }).body).toBe("#3 · x");
    expect(buildApprovalCardPrompt({ seq: 3, toolName: "x", reason: "   " }).body).toBe("#3 · x");
  });

  it("always returns the same two buttons regardless of the prompt", () => {
    const a = buildApprovalCardPrompt({ seq: 1, toolName: "a" });
    const b = buildApprovalCardPrompt({ seq: 99, toolName: "b", reason: "r" });
    expect(a.agree).toEqual(b.agree);
    expect(a.reject).toEqual(b.reject);
  });
});

describe("buildApprovalCardSettled", () => {
  const base = { seq: 4, toolName: "run_shell" };

  it("maps allowed-once to 已同意", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "allowed-once", reason: "answered" });
    expect(card.statusLine).toBe("已同意");
  });

  it("maps rejected+answered to 已拒绝", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "rejected", reason: "answered" });
    expect(card.statusLine).toBe("已拒绝");
  });

  it("maps rejected+timeout to 已超时拒绝", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "rejected", reason: "timeout" });
    expect(card.statusLine).toBe("已超时拒绝");
  });

  it("maps cancelled+desktop to 已在桌面处理", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "cancelled", reason: "desktop" });
    expect(card.statusLine).toBe("已在桌面处理");
  });

  it("maps cancelled+cancelled to 已取消", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "cancelled", reason: "cancelled" });
    expect(card.statusLine).toBe("已取消");
  });

  it("falls back unavailable to 已取消 (not a human/timeout outcome, closest honest copy)", () => {
    const card = buildApprovalCardSettled({ ...base, outcome: "unavailable", reason: "cancelled" });
    expect(card.statusLine).toBe("已取消");
  });

  it("keeps the same header and numbered body as the pending card, without a reason line", () => {
    const card = buildApprovalCardSettled({ seq: 7, toolName: "write_file", outcome: "allowed-once", reason: "answered" });
    expect(card.header).toBe("需要你的审批");
    expect(card.body).toBe("#7 · write_file");
  });
});
