import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LarkMark } from "../brand-mark";

describe("LarkMark", () => {
  it("renders the official Feishu app icon as an embedded, decorative image", () => {
    const { container } = render(<LarkMark size={22} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/));
    expect(img).toHaveAttribute("width", "22");
    expect(img).toHaveAttribute("height", "22");
    expect(img).toHaveAttribute("alt", "");
  });

  it("sizes to the given `size`, defaulting to 22", () => {
    const { container } = render(<LarkMark />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("width", "22");
    expect(img).toHaveAttribute("height", "22");
  });
});
