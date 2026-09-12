import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LarkConnectorDetails } from "../LarkConnectorDetails";

describe("LarkConnectorDetails", () => {
  it("presents the provider overview and capabilities without outlined cards", () => {
    const { container } = render(<LarkConnectorDetails />);
    expect(
      screen.getByText(/Bring AI into|把 AI 带进/),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Capabilities|可用能力/ }),
    ).toBeVisible();
    expect(screen.getByText(/Chat with your AI assistant|在聊天中随时找 AI 帮忙/)).toBeVisible();
    expect(
      container.querySelector("[data-provider-details='lark']"),
    ).not.toHaveClass("border");
    expect(container.innerHTML).not.toContain("text-[11px]");
  });
});
