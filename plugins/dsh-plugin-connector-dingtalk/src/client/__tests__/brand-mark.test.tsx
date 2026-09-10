import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DingtalkMark } from "../brand-mark";

describe("DingtalkMark", () => {
  it("renders a flat, decorative DingTalk vector without app-icon chrome", () => {
    const { container } = render(<DingtalkMark size={22} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 1024 1024");
    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveStyle({ color: "#1677ff" });
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(
      container.querySelector("filter, linearGradient"),
    ).not.toBeInTheDocument();
  });

  it("sizes to the given `size`, defaulting to 22", () => {
    const { container } = render(<DingtalkMark />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "22");
    expect(svg).toHaveAttribute("height", "22");
  });
});
