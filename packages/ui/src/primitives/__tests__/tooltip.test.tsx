import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";

describe("TooltipContent", () => {
  it("uses the shared non-interactive hint frame", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>Inspect</TooltipTrigger>
          <TooltipContent>Short explanation</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    await user.hover(screen.getByRole("button", { name: "Inspect" }));
    await screen.findByRole("tooltip");
    const tooltip = document.querySelector('[data-ui-overlay="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(tooltip).toHaveAttribute("data-ui-overlay", "tooltip");
    expect(tooltip).toHaveClass(
      "rounded-md",
      "border-border/60",
      "shadow-popover",
      "duration-100",
    );
  });
});
