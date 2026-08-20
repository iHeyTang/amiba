/**
 * Amiba's shadow of the official `command-popup` overlay entry.
 *
 * The controller is the official `PopupSelectController`'s face — single
 * flight, local filtering, the acknowledge-then-confirm gate — so this file
 * asserts only what Amiba owns: that the state renders, that the verbs are
 * called, and that the SHARED CONFIRMATION GATE is present and gated on the
 * acknowledgement (the property upstream's `RiskConfirmation` provides, which
 * a `--dsw-*` token bridge could never have delivered here because
 * `dsh-client-ui-primitives` ships its CSS modules stubbed).
 */

import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandPopup, filterOptions, type CommandPopupController } from "../triggers/CommandPopup";
import type { PopupState, SelectOption } from "@amiba/extension-sdk";

const OPTIONS: SelectOption[] = [
  { id: "a", label: "gpt-tiny", detail: "fast" },
  { id: "b", label: "gpt-huge", detail: "slow", active: true },
  {
    id: "c",
    label: "wipe everything",
    confirmation: {
      title: "This deletes data",
      description: "There is no undo.",
      acknowledgeLabel: "I understand",
      cancelLabel: "Cancel",
      confirmLabel: "Wipe",
    },
  },
];

function controller(overrides: Partial<PopupState> = {}) {
  const state: PopupState = {
    open: true,
    command: "model",
    status: "ready",
    options: OPTIONS,
    search: "",
    active: 0,
    submitting: false,
    confirming: null,
    acknowledged: false,
    error: null,
    ...overrides,
  };
  const calls = {
    select: vi.fn(async (_index: number) => {}),
    confirm: vi.fn(async () => {}),
    acknowledge: vi.fn(),
    cancelConfirmation: vi.fn(),
    setSearch: vi.fn(),
    move: vi.fn(),
    highlight: vi.fn(),
    dismiss: vi.fn(),
  };
  const popup: CommandPopupController = {
    state: { getSnapshot: () => state, subscribe: () => () => {} },
    ...calls,
  };
  return { popup, calls, state };
}

describe("CommandPopup", () => {
  it("renders the loaded rows with their detail and active mark", () => {
    const { popup } = controller();
    render(<CommandPopup popup={popup} />);
    expect(screen.getByText("gpt-tiny")).toBeTruthy();
    expect(screen.getByText("slow")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("routes a click to the official controller's select", () => {
    const { popup, calls } = controller();
    render(<CommandPopup popup={popup} />);
    act(() => {
      screen.getByText("gpt-huge").closest("button")!.click();
    });
    expect(calls.select).toHaveBeenCalledWith(1);
  });

  it("renders the SHARED confirmation gate and keeps confirm disabled until acknowledged", () => {
    const { popup, calls } = controller({ confirming: OPTIONS[2] });
    const view = render(<CommandPopup popup={popup} />);
    expect(screen.getByText("This deletes data")).toBeTruthy();
    expect(screen.getByText("There is no undo.")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Wipe" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    act(() => {
      screen.getByRole("button", { name: "Cancel" }).click();
    });
    expect(calls.cancelConfirmation).toHaveBeenCalled();
    view.unmount();

    const acknowledged = controller({
      acknowledged: true,
      confirming: OPTIONS[2],
    });
    render(<CommandPopup popup={acknowledged.popup} />);
    const enabled = screen.getByRole("button", { name: "Wipe" });
    expect(enabled.hasAttribute("disabled")).toBe(false);
    act(() => {
      enabled.click();
    });
    expect(acknowledged.calls.confirm).toHaveBeenCalled();
  });

  it("renders nothing while closed", () => {
    const { popup } = controller({ open: false });
    const { container } = render(<CommandPopup popup={popup} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the load failure with a retry when the host wired one", () => {
    const { popup } = controller({ error: "boom", status: "failed" });
    const onRetry = vi.fn();
    render(<CommandPopup onRetry={onRetry} popup={popup} />);
    expect(screen.getByText("boom")).toBeTruthy();
    act(() => {
      screen.getByRole("button", { name: "重试" }).click();
    });
    expect(onRetry).toHaveBeenCalled();
  });

  it("mirrors the official filterOptions rule", () => {
    expect(filterOptions(OPTIONS, "").map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(filterOptions(OPTIONS, "HUGE").map((o) => o.id)).toEqual(["b"]);
    // Detail participates in the match, exactly as upstream's does.
    expect(filterOptions(OPTIONS, "fast").map((o) => o.id)).toEqual(["a"]);
    expect(filterOptions(OPTIONS, "zzz")).toEqual([]);
  });
});
