import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SettingsDialog } from "../SettingsDialog";

function Harness({ onClose }: { onClose?: () => void } = {}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        type="button"
      >
        Settings
      </button>
      <SettingsDialog
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
        open={open}
        titleId="harness-title"
      >
        <h1 id="harness-title">Settings panel</h1>
        <button type="button">Inside</button>
      </SettingsDialog>
    </>
  );
}

describe("SettingsDialog", () => {
  it("renders nothing at all while closed", () => {
    const { container } = render(
      <SettingsDialog onClose={() => {}} open={false} titleId="t">
        <p>body</p>
      </SettingsDialog>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("is a modal dialog named after the navigation heading", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "harness-title");
    expect(screen.getByRole("dialog", { name: "Settings panel" })).toBe(dialog);
  });

  it("reports its open state on the trigger, as the official shell does", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Settings" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not listen for Escape while closed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SettingsDialog onClose={onClose} open={false} titleId="t">
        <p>body</p>
      </SettingsDialog>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on an outside (mask) click but not on a click inside the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Settings" }));

    await user.click(screen.getByRole("button", { name: "Inside" }));
    expect(onClose).not.toHaveBeenCalled();

    const mask = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(mask).not.toBeNull();
    await user.click(mask!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("takes focus on open and returns it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Settings" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });
});
