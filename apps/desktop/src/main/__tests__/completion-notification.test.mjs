import assert from "node:assert/strict";
import test from "node:test";

const {
  buildApprovalPendingNotification,
  buildChatCompletedNotification,
  shouldNotifyForWindowState,
} = await import("../chat/completion-notification.ts");

function windowState(overrides = {}) {
  const state = {
    destroyed: false,
    focusable: true,
    focused: false,
    visible: true,
    minimized: false,
    ...overrides,
  };
  return {
    isDestroyed: () => state.destroyed,
    isFocusable: () => state.focusable,
    isFocused: () => state.focused,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
  };
}

test("completion reminder appears when no app window is open or focused", () => {
  assert.equal(shouldNotifyForWindowState([], null), true);
  assert.equal(
    shouldNotifyForWindowState([windowState({ focused: false })], null),
    true,
  );
  assert.equal(
    shouldNotifyForWindowState(
      [windowState({ focused: true, minimized: true })],
      null,
    ),
    true,
  );
});

test("completion reminder stays quiet while a visible app window is focused", () => {
  const main = windowState({ focused: true });
  assert.equal(shouldNotifyForWindowState([main], null), false);

  const notifier = windowState({ focused: true });
  assert.equal(shouldNotifyForWindowState([notifier], notifier), true);
});

test("completion notifier uses the latest user prompt and assistant summary", () => {
  const message = buildChatCompletedNotification({
    sessionId: "session-a",
    assistantUiId: "assistant-a",
    history: [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "summarize the release" },
    ],
    assistantText: "The release is ready for review.",
    timestamp: 42,
  });

  assert.deepEqual(message, {
    type: "chat-completed",
    id: "chat_session-a_assistant-a",
    sessionId: "session-a",
    title: "summarize the release",
    summary: "The release is ready for review.",
    timestamp: 42,
  });
});

test("completion notifier hides attachment metadata from its title", () => {
  const message = buildChatCompletedNotification({
    sessionId: "session-b",
    assistantUiId: "assistant-b",
    history: [
      {
        role: "user",
        content:
          "The user attached a file.\n<file-attachment>\nName: plan.pdf\n</file-attachment>\n\n找出风险",
      },
    ],
    assistantText: "发现两个风险。",
    timestamp: 43,
  });

  assert.equal(message.title, "找出风险");
});

test("approval notifier uses the conversation title and keeps its session target", () => {
  const message = buildApprovalPendingNotification({
    approvalId: "approval-a",
    sessionId: "session-a",
    sessionTitle: "发布前检查",
    history: [{ role: "user", content: "run the release script" }],
    tool: "terminal",
    command: "pnpm release",
    message: "Needs access",
    timestamp: 44,
  });

  assert.deepEqual(message, {
    type: "approval-pending",
    approvalId: "approval-a",
    sessionId: "session-a",
    title: "发布前检查",
    tool: "terminal",
    command: "pnpm release",
    message: "Needs access",
    timestamp: 44,
  });
});

test("approval notifier falls back to the latest prompt before a title exists", () => {
  const message = buildApprovalPendingNotification({
    approvalId: "approval-b",
    sessionId: "session-b",
    history: [{ role: "user", content: "检查依赖版本" }],
    message: "Needs access",
    timestamp: 45,
  });

  assert.equal(message.title, "检查依赖版本");
});
