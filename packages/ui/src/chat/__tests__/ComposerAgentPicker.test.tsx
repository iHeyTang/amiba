import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  getPersonalities: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  getHermesProfiles: mocks.getProfiles,
  getHermesPersonalities: mocks.getPersonalities,
  normalizeAgentContext: (value: {
    profileId?: string;
    personality?: { key: string; prompt: string };
  }) => ({
    profileId: value.profileId?.trim() || "default",
    ...(value.personality ? { personality: value.personality } : {}),
  }),
}));

vi.mock("@amiba/i18n", () => {
  const t = (key: string) => {
    if (key === "sidepanel.agentPicker.defaultProfile") return "Amiba";
    if (key === "common.builtin") return "内置";
    return key;
  };
  return { useT: () => ({ t }) };
});

import { ComposerAgentPicker } from "../ComposerAgentPicker";

describe("ComposerAgentPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "default",
      current: "default",
      profiles: [
        {
          name: "default",
          description: "General work",
          model: "model-a",
        },
        {
          name: "researcher",
          description: "Investigates sources",
          model: "model-b",
        },
      ],
    });
    mocks.getPersonalities.mockResolvedValue({
      ok: true,
      personalities: [
        {
          key: "concise",
          builtin: true,
          overridden: false,
          description: "Short, direct answers",
          preview: "Be concise",
          prompt: "Answer concisely.",
        },
      ],
    });
  });

  it("selects a task agent and clears a mode tied to the previous agent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerAgentPicker
        onChange={onChange}
        value={{
          profileId: "default",
          personality: { key: "concise", prompt: "Answer concisely." },
        }}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: Amiba · concise",
    });
    expect(trigger).toHaveClass("rounded-full");
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(dialog).toHaveAttribute("data-composer-overlay");
    expect(within(dialog).getAllByText("Amiba")).toHaveLength(2);
    expect(within(dialog).getByText("内置")).toBeInTheDocument();
    await user.click(within(dialog).getByText("researcher"));

    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith({ profileId: "researcher" });
  });

  it("does not mark a Profile replacement as built in", async () => {
    mocks.getPersonalities.mockResolvedValue({
      ok: true,
      personalities: [
        {
          key: "concise",
          builtin: true,
          overridden: true,
          description: "Profile-specific response mode",
          preview: "Use the Profile instructions",
          prompt: "Use the Profile instructions.",
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <ComposerAgentPicker
        onChange={vi.fn()}
        value={{ profileId: "researcher" }}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: researcher",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(within(dialog).queryByText("内置")).not.toBeInTheDocument();
  });

  it("keeps Profile selection modal while making its overlay transparent when requested", async () => {
    const user = userEvent.setup();
    render(
      <ComposerAgentPicker
        dialogSize="tall"
        onChange={vi.fn()}
        overlayVariant="transparent"
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
    expect(dialog).toHaveAttribute("data-agent-picker-modal", "true");
    expect(dialog).toHaveClass("fixed");
    expect(dialog).toHaveClass("h-[min(calc(100vh-2rem),32rem)]");
    expect(
      document.querySelector('[data-dialog-overlay="transparent"]'),
    ).toHaveClass("bg-transparent");

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", {
        name: "sidepanel.agentPicker.executionIdentity",
      }),
    ).not.toBeInTheDocument();
  });

  it("retries a stale mount-time Profile failure on the next host refresh", async () => {
    mocks.getProfiles.mockResolvedValueOnce({
      ok: false,
      error: "stale startup failure",
      profiles: [],
    });
    const { rerender } = render(
      <ComposerAgentPicker
        onChange={vi.fn()}
        refreshKey={0}
        value={{ profileId: "default" }}
      />,
    );

    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: Amiba",
      }),
    ).not.toBeInTheDocument();

    rerender(
      <ComposerAgentPicker
        onChange={vi.fn()}
        refreshKey={1}
        value={{ profileId: "default" }}
      />,
    );
    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: Amiba",
      }),
    ).toBeEnabled();
  });

  it("keeps the localized root Profile name display-only", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerAgentPicker
        onChange={onChange}
        value={{ profileId: "researcher" }}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: researcher",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    await user.click(within(dialog).getByText("Amiba"));

    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith({ profileId: "default" });
  });

  it("preloads response modes and keeps the dialog frame stable while switching Profiles", async () => {
    const user = userEvent.setup();
    let finishProfileLoad!: (value: unknown) => void;
    mocks.getPersonalities
      .mockResolvedValueOnce({
        ok: true,
        personalities: [
          {
            key: "concise",
            description: "Short, direct answers",
            preview: "Be concise",
            prompt: "Answer concisely.",
          },
        ],
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishProfileLoad = resolve;
          }),
      );

    render(
      <ComposerAgentPicker
        onChange={vi.fn()}
        value={{ profileId: "researcher" }}
      />,
    );
    expect(
      screen.queryByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: researcher",
      }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(finishProfileLoad).toBeTypeOf("function"));
    await act(async () => {
      finishProfileLoad({ ok: true, personalities: [] });
    });
    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: researcher",
    });
    expect(trigger).toBeEnabled();
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(dialog).toHaveClass("h-[min(68vh,32rem)]");

    await user.click(within(dialog).getByText("Amiba"));

    expect(
      screen.getByRole("dialog", {
        name: "sidepanel.agentPicker.executionIdentity",
      }),
    ).toBe(dialog);
    expect(within(dialog).getByText("concise")).toBeInTheDocument();
    expect(mocks.getPersonalities).toHaveBeenCalledTimes(2);
  });

  it("applies a response mode only to the selected task agent", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ComposerAgentPicker
        onChange={onChange}
        value={{ profileId: "researcher" }}
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "sidepanel.agentPicker.executionIdentity: researcher",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    await waitFor(() => {
      expect(mocks.getPersonalities).toHaveBeenCalledWith("researcher");
    });
    await user.click(within(dialog).getByText("concise"));

    expect(onChange).toHaveBeenCalledWith({
      profileId: "researcher",
      personality: {
        key: "concise",
        prompt: "Answer concisely.",
      },
    });
  });

  it("locks only the Profile after a task has started", async () => {
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
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    expect(
      within(dialog).getByText("sidepanel.agentPicker.profileLocked"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /researcher/ }),
    ).toBeDisabled();

    await user.click(within(dialog).getByText("concise"));
    expect(onChange).toHaveBeenCalledWith({
      profileId: "default",
      personality: {
        key: "concise",
        prompt: "Answer concisely.",
      },
    });
  });

  it("hides Profile selection when there is no alternative Profile", async () => {
    mocks.getProfiles.mockResolvedValueOnce({
      ok: true,
      active: "default",
      current: "default",
      profiles: [
        {
          name: "default",
          description: "General work",
          model: "model-a",
        },
      ],
    });

    render(
      <ComposerAgentPicker
        onChange={vi.fn()}
        value={{ profileId: "default" }}
      />,
    );

    await waitFor(() => expect(mocks.getProfiles).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: Amiba",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.getPersonalities).not.toHaveBeenCalled();
  });
});
