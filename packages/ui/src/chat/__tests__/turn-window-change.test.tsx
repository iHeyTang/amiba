import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";

describe("turn window reporting", () => {
  it("reports the window once per content change, not per streamed frame", () => {
    const onChange = vi.fn();
    const row = (streaming: boolean): UiMessage[] => [
      { uiId: "u1", role: "user", content: "q", runtimeTurn: 0 },
      {
        uiId: "a1",
        role: "assistant",
        content: `r${streaming ? " (growing…)" : ""}`,
        runtimeTurn: 0,
        runtimeSeq: 2,
        streaming,
      },
    ];
    const { rerender } = render(
      <MessageTurns messages={row(false)} onTurnsWindowChange={onChange} />,
    );
    const initial = onChange.mock.calls.length;
    expect(initial).toBeGreaterThan(0);

    // A streamed frame changes only the message CONTENT: the window is
    // identical, so the rail must not be told about it.
    rerender(
      <MessageTurns messages={row(true)} onTurnsWindowChange={onChange} />,
    );
    expect(onChange.mock.calls.length).toBe(initial);

    // A genuinely different window (a new user turn) still reports.
    rerender(
      <MessageTurns
        messages={[
          ...row(false),
          { uiId: "u2", role: "user", content: "q2", runtimeTurn: 1 },
        ]}
        onTurnsWindowChange={onChange}
      />,
    );
    expect(onChange.mock.calls.length).toBeGreaterThan(initial);
  });
});