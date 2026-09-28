import { createRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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


it("keeps the native viewport and scroll position when the turn rail hides its scrollbar", () => {
  const viewportRef = createRef<HTMLDivElement>();
  const onScroll = vi.fn();
  const view = render(<ScrollArea nativeViewport viewportRef={viewportRef} viewportProps={{ onScroll, "aria-label": "History" }}><div>History body</div></ScrollArea>);
  const viewport = viewportRef.current!;
  viewport.scrollTop = 150;
  expect(viewport).toHaveStyle({ overflowY: "scroll" });
  expect(viewport).toHaveAttribute("tabindex", "0");
  view.rerender(<ScrollArea nativeViewport hideScrollbar viewportRef={viewportRef} viewportProps={{ onScroll, "aria-label": "History" }}><div>More history</div></ScrollArea>);
  expect(viewportRef.current).toBe(viewport);
  expect(viewport.scrollTop).toBe(150);
  expect(viewport).toHaveClass("[scrollbar-width:none]");
  expect(viewport).toHaveAttribute("aria-label", "History");
  expect(view.queryByText("More history")).toBeInTheDocument();
  expect(view.container.querySelector("[data-amiba-scrollbar]")).toBeNull();
  fireEvent.scroll(viewport);
  expect(onScroll).toHaveBeenCalledOnce();
});
