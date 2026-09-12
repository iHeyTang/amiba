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
    t: (key: string, values?: { name?: string }) =>
      key === "sidepanel.agentPicker.defaultProfile" ? "Amiba" : values?.name ? `${key}: ${values.name}` : key,
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
        { id: "default", name: "Amiba", description: "General work" },
        { id: "researcher", name: "资料研究员", description: "Investigates sources" },
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
    await user.click(within(dialog).getByRole("button", { name: "资料研究员 Investigates sources" }));

    expect(onChange).toHaveBeenCalledWith({ profileId: "researcher" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens current and alternative identity details without changing the selection", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ComposerAgentPicker onChange={onChange} value={{ profileId: "default" }} />);
    await user.click(await screen.findByRole("button", { name: "sidepanel.agentPicker.executionIdentity: Amiba" }));
    const picker = await screen.findByRole("dialog", { name: "sidepanel.agentPicker.executionIdentity" });
    const selection = within(picker).getByRole("button", { name: "Amiba General work" });
    expect(selection).toHaveAttribute("aria-current", "true");
    const info = within(picker).getByRole("button", { name: "sidepanel.agentPicker.details.openFor: Amiba" });
    expect(info.querySelector(".lucide-check")).toHaveClass("group-hover/identity:opacity-0");
    expect(info.querySelector(".lucide-info")).toHaveClass("group-hover/identity:opacity-100");
    await user.hover(selection);
    await user.click(info);
    const details = await screen.findByRole("dialog", { name: "Amiba" });
    expect(details).toHaveAttribute("data-agent-details-modal");
    expect(within(details).getByText("General work")).toBeVisible();
    expect(within(details).getByText("default")).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Amiba" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "sidepanel.agentPicker.executionIdentity" })).toBeVisible();
    expect(info).toHaveFocus();
    await user.click(within(picker).getByRole("button", { name: "sidepanel.agentPicker.details.openFor: 资料研究员" }));
    expect(await screen.findByRole("dialog", { name: "资料研究员" })).toHaveTextContent("Investigates sources");
    expect(onChange).not.toHaveBeenCalled();
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

  it("keeps a locked identity readable and explains the lock without opening the picker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerAgentPicker
        profileLocked
        onChange={onChange}
        value={{ profileId: "default" }}
      />,
    );
    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: Amiba",
    });
    expect(trigger).toBeEnabled();
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    await user.click(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("sidepanel.agentPicker.profileLocked");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides the selector when DSH exposes no alternative preset", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "standard",
      current: "standard",
      profiles: [{ id: "standard", name: "标准模式", description: "Default DSH preset" }],
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
