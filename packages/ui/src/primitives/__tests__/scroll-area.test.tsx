import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollArea } from "../scroll-area";

describe("ScrollArea", () => {
  it("keeps Radix scrolling enabled when its scrollbar is visually hidden", () => {
    const { container } = render(
      <ScrollArea hideScrollbar>
        <div>Scrollable content</div>
      </ScrollArea>,
    );

    const viewport = container.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    expect(viewport).toHaveClass("[scrollbar-width:none]");
    expect(viewport).toHaveStyle({ overflowY: "scroll" });
  });
});
