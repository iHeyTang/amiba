import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DingtalkMark } from "../brand-mark";

describe("DingtalkMark", () => {
  it("renders the official DingTalk app icon as an embedded, decorative image", () => {
    const { container } = render(<DingtalkMark size={22} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/));
    expect(img).toHaveAttribute("width", "22");
    expect(img).toHaveAttribute("height", "22");
    expect(img).toHaveAttribute("alt", "");
  });

  it("sizes to the given `size`, defaulting to 22", () => {
    const { container } = render(<DingtalkMark />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("width", "22");
    expect(img).toHaveAttribute("height", "22");
  });
});
