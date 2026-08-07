import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../dialog";

describe("DialogContent", () => {
  it("keeps enter and exit animation transforms centered", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Centered dialog</DialogTitle>
          <DialogDescription>Animation contract</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Centered dialog" });
    expect(dialog).toHaveAttribute("data-ui-overlay", "dialog");
    expect(dialog).toHaveClass(
      "rounded-2xl",
      "border-border/60",
      "shadow-overlay",
      "max-w-lg",
    );
    expect(dialog.style.getPropertyValue("--tw-enter-translate-x")).toBe(
      "-50%",
    );
    expect(dialog.style.getPropertyValue("--tw-enter-translate-y")).toBe(
      "-50%",
    );
    expect(dialog.style.getPropertyValue("--tw-exit-translate-x")).toBe("-50%");
    expect(dialog.style.getPropertyValue("--tw-exit-translate-y")).toBe("-50%");
    expect(dialog.style.transformOrigin).toBe("center");
  });
});
