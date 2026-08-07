import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Popover, PopoverContent, PopoverTrigger } from "../popover";

describe("PopoverContent", () => {
  it("owns the shared anchored-surface frame and interaction lifecycle", async () => {
    const user = userEvent.setup();
    render(
      <Popover>
        <PopoverTrigger>Open details</PopoverTrigger>
        <PopoverContent aria-label="Details" size="lg">
          Anchored content
        </PopoverContent>
      </Popover>,
    );

    await user.click(screen.getByRole("button", { name: "Open details" }));
    const content = screen.getByLabelText("Details");
    expect(content).toHaveAttribute("data-ui-overlay", "popover");
    expect(content).toHaveClass(
      "rounded-xl",
      "border-border/60",
      "shadow-popover",
      "w-[22rem]",
      "data-[state=closed]:fill-mode-forwards",
    );

    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Details")).not.toBeInTheDocument();
  });
});
