import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import {
  WorkspacePane,
  WorkspacePaneProvider,
  useWorkspacePane,
} from "../WorkspacePane";
import type { WorkspaceInspectorCapability } from "../internal/capabilities";

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  });
  return event;
}

function Probe() {
  const pane = useWorkspacePane();
  return (
    <>
      <button type="button" onClick={pane.toggle} aria-pressed={pane.open}>
        toggle workspace
      </button>
      <output aria-label="workspace width">{pane.width}</output>
    </>
  );
}

describe("WorkspacePane responsive behavior", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("allows the workbench to remain open when the viewport is compact", async () => {
    const capability = {
      files: {},
    } as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    const toggle = screen.getByRole("button", {
      name: "toggle workspace",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    const pane = screen.getByLabelText("workspacePane.title");
    expect(pane.parentElement).toHaveClass("max-[1100px]:!w-1/2");
    expect(pane).toHaveClass(
      "max-[1100px]:!w-full",
      "max-[1100px]:!max-w-none",
    );
  });

  it("previews resize directly and commits the width once dragging ends", async () => {
    const capability = {
      files: {},
    } as WorkspaceInspectorCapability;

    render(
      <WorkspacePaneProvider capability={capability} sessionId="session-1">
        <Probe />
        <WorkspacePane />
      </WorkspacePaneProvider>,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "toggle workspace" }),
    );

    const separator = screen.getByRole("separator");
    const pane = screen.getByLabelText("workspacePane.title");
    const container = pane.parentElement as HTMLElement;

    fireEvent(separator, pointerEvent("pointerdown", 500));
    fireEvent(separator, pointerEvent("pointermove", 400));

    expect(container.style.width).toBe("620px");
    expect(pane.style.width).toBe("620px");
    expect(screen.getByLabelText("workspace width")).toHaveTextContent("520");

    fireEvent(separator, pointerEvent("pointerup", 400));

    await waitFor(() => {
      expect(screen.getByLabelText("workspace width")).toHaveTextContent("620");
    });
  });
});
