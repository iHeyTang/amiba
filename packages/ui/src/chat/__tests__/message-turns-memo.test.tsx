import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));

import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

/**
 * Round-1 regression guard: MessageTurns is memoized so a keystroke (a
 * ChatSurface re-render whose conversation props are unchanged) must NOT
 * rebuild the turns. Measured deterministically through the
 * `assistantActions` render slot: it is invoked once per assistant reply per
 * actual MessageTurns render, so a memo bail leaves the call counter
 * untouched — no timing, no flake.
 */
describe("MessageTurns memo — typing must not rebuild the conversation", () => {
  it("skips re-rendering when every prop keeps its reference", () => {
    let actionCalls = 0;
    const AssistantActions = () => {
      actionCalls += 1;
      return null;
    };
    const messages: UiMessage[] = [
      { uiId: "u1", role: "user", content: "hello" },
      { uiId: "a1", role: "assistant", content: "world", assistantMessageId: "a1-msg" },
      { uiId: "u2", role: "user", content: "again" },
      { uiId: "a2", role: "assistant", content: "done", assistantMessageId: "a2-msg" },
    ];
    const props = {
      sessionId: "s1",
      messages,
      assistantActions: () => <AssistantActions />,
    };
    const { rerender } = render(<MessageTurns {...props} />);
    const afterMount = actionCalls;
    expect(afterMount).toBeGreaterThan(0);
    // Keystroke-equivalent re-render: identical prop references must bail.
    rerender(<MessageTurns {...props} />);
    expect(actionCalls).toBe(afterMount);
  });
});