import { render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
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
      name: "sidepanel.agentPicker.executionIdentity: default · concise",
    });
    expect(trigger).toHaveClass("rounded-full");
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: "sidepanel.agentPicker.executionIdentity",
    });
    await user.click(within(dialog).getByText("researcher"));

    expect(onChange).toHaveBeenCalledWith({ profileId: "researcher" });
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

    await user.click(
      screen.getByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: researcher",
      }),
    );
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

  it("locks the combined execution identity after a task has started", async () => {
    render(
      <ComposerAgentPicker
        locked
        onChange={vi.fn()}
        value={{ profileId: "default" }}
      />,
    );

    expect(
      await screen.findByRole("button", {
        name: "sidepanel.agentPicker.executionIdentity: default",
      }),
    ).toBeDisabled();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("stays out of the ordinary composer when only the default agent exists", async () => {
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

    await waitFor(() =>
      expect(screen.queryByRole("button")).not.toBeInTheDocument(),
    );
  });
});
