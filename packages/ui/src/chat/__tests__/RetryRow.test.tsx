import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@amiba/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
import { MessageTurns } from "../bubble/Bubble";
import type { UiMessage } from "../internal/types";
it("shows a retry-only turn live and keeps its record after stopping", () => {
  const message: UiMessage = {
    uiId: "a",
    role: "assistant",
    content: "",
    streaming: true,
    assistantTimeline: [
      {
        kind: "retry",
        id: "r",
        retry: {
          id: "r",
          attempt: 6,
          delayMs: 10000,
          startedAt: 100,
          status: "waiting",
        },
      },
    ],
  };
  const { rerender } = render(<MessageTurns messages={[message]} />);
  expect(screen.getByText("sidepanel.retry.waiting")).toBeVisible();
  rerender(<MessageTurns messages={[{ ...message, streaming: false }]} />);
  expect(screen.getByText("sidepanel.retry.record")).toBeVisible();
  expect(screen.queryByText("sidepanel.retry.waiting")).toBeNull();
});
