import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProfiles: vi.fn() }));

vi.mock("@amiba/app-runtime/core", () => ({
  getAgentPresets: mocks.getProfiles,
  normalizeAgentContext: (value: { profileId?: string }) => ({
    profileId: value.profileId?.trim() || "default",
  }),
}));

vi.mock("@amiba/i18n", () => ({
  useT: () => ({
    t: (key: string) =>
      key === "sidepanel.agentPicker.defaultProfile" ? "Amiba" : key,
  }),
}));

import { ComposerAgentPicker } from "../ComposerAgentPicker";

describe("ComposerAgentPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "default",
      current: "default",
      profiles: [
        { name: "default", description: "General work" },
        { name: "researcher", description: "Investigates sources" },
      ],
    });
  });

  it("selects a DSH Agent Preset directly", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerAgentPicker
        onChange={onChange}
        value={{ profileId: "default" }}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: Amiba",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    await user.click(within(dialog).getByRole("button", { name: /researcher/ }));

    expect(onChange).toHaveBeenCalledWith({ profileId: "researcher" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the existing modal style and supports a transparent overlay", async () => {
    const user = userEvent.setup();
    render(
      <ComposerAgentPicker
        dialogSize="tall"
        onChange={vi.fn()}
        overlayVariant="transparent"
        value={{ profileId: "default" }}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: Amiba",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(dialog).toHaveAttribute("data-agent-picker-modal", "true");
    expect(dialog).toHaveClass("h-[min(calc(100vh-2rem),32rem)]");
    expect(
      document.querySelector('[data-dialog-overlay="transparent"]'),
    ).toHaveClass("bg-transparent");
  });

  it("locks preset changes after a task has started", async () => {
    const user = userEvent.setup();
    render(
      <ComposerAgentPicker
        profileLocked
        onChange={vi.fn()}
        value={{ profileId: "default" }}
      />,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: Amiba",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(within(dialog).getByRole("button", { name: /researcher/ })).toBeDisabled();
    expect(within(dialog).getByText("sidepanel.agentPicker.profileLocked")).toBeVisible();
  });

  it("hides the selector when DSH exposes no alternative preset", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "standard",
      current: "standard",
      profiles: [{ name: "standard", description: "Default DSH preset" }],
    });
    render(
      <ComposerAgentPicker
        onChange={vi.fn()}
        value={{ profileId: "standard" }}
      />,
    );
    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledOnce());
    expect(
      screen.queryByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: standard",
      }),
    ).not.toBeInTheDocument();
  });
});
