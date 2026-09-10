import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DingtalkConnectorDetails } from "../DingtalkConnectorDetails";

describe("DingtalkConnectorDetails", () => {
  it("presents the provider overview and capabilities without outlined cards", () => {
    const { container } = render(<DingtalkConnectorDetails />);
    expect(
      screen.getByText(/Stream Mode robot|Stream Mode 机器人/),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: /Capabilities|可用能力/ }),
    ).toBeVisible();
    expect(screen.getAllByText(/Stream Mode/).length).toBeGreaterThan(0);
    expect(
      container.querySelector("[data-provider-details='dingtalk']"),
    ).not.toHaveClass("border");
    expect(container.innerHTML).not.toContain("text-[11px]");
  });
});
