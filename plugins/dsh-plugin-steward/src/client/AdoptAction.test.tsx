import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdoptAction } from "./AdoptAction.js";
import { createStewardClientState } from "./state.js";

describe("AdoptAction", () => {
  beforeEach(() => {
    document.documentElement.lang = "zh-CN";
  });

  it("hides itself on the steward session and on sessions already adopted", () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    state.setAdopted(["session-a"]);
    const { container, rerender } = render(
      <AdoptAction sessionId={"session-s" as never} state={state} adopt={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<AdoptAction sessionId={"session-a" as never} state={state} adopt={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("adopts the current session and flips to the done label", async () => {
    const state = createStewardClientState();
    state.setStewardSessionId("session-s");
    const adopt = vi.fn().mockResolvedValue({ kind: "adopted", existing: false, task: { id: "t", sessionId: "session-x" } });
    render(<AdoptAction sessionId={"session-x" as never} state={state} adopt={adopt} />);
    await userEvent.click(screen.getByRole("button", { name: "交给大管家" }));
    expect(adopt).toHaveBeenCalledWith("session-x");
    expect(await screen.findByText("已交给大管家")).toBeVisible();
    expect(state.adoptedSessionIds().has("session-x")).toBe(true);
  });
});
