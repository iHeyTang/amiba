import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LarkConnectorDetails } from "../LarkConnectorDetails";

describe("LarkConnectorDetails", () => {
  it("presents the provider overview and capabilities without outlined cards", () => {
    const { container } = render(<LarkConnectorDetails />);
    expect(
      screen.getByText(/official long connection|官方长连接/),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Capabilities|可用能力/ }),
    ).toBeVisible();
    expect(screen.getByText(/Bot conversations|机器人会话/)).toBeVisible();
    expect(
      container.querySelector("[data-provider-details='lark']"),
    ).not.toHaveClass("border");
    expect(container.innerHTML).not.toContain("text-[11px]");
  });
});
