import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaneHeaderBar } from "./PaneHeaderBar";

describe("PaneHeaderBar", () => {
  it("renders leading and trailing clusters at the given height", () => {
    render(
      <PaneHeaderBar
        data-testid="bar"
        heightPx={48}
        leftInset={78}
        leading={<span>Title</span>}
        trailing={<button type="button">Act</button>}
      />,
    );
    const bar = screen.getByTestId("bar");
    expect(bar.tagName).toBe("HEADER");
    expect(bar.style.height).toBe("48px");
    expect(bar.style.paddingLeft).toBe("78px");
    expect(screen.getByText("Title")).toBeVisible();
    expect(screen.getByRole("button", { name: "Act" })).toBeVisible();
  });

  it("clamps left inset to the 12px page gutter and defaults to 40px height", () => {
    render(<PaneHeaderBar data-testid="bar" leading="x" />);
    const bar = screen.getByTestId("bar");
    expect(bar.style.height).toBe("40px");
    expect(bar.style.paddingLeft).toBe("12px");
  });

  it("keeps the trailing cluster out of the drag region", () => {
    render(<PaneHeaderBar trailing={<span>T</span>} />);
    expect(screen.getByText("T").parentElement).toHaveClass("app-no-drag");
  });

  it("adds border-b when bordered={true} and omits it by default", () => {
    const { rerender } = render(<PaneHeaderBar data-testid="bar" />);
    expect(screen.getByTestId("bar")).not.toHaveClass("border-b");

    rerender(<PaneHeaderBar data-testid="bar" bordered={true} />);
    expect(screen.getByTestId("bar")).toHaveClass("border-b");
  });
});
