import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPersonalities: vi.fn(),
  savePersonality: vi.fn(),
  deletePersonality: vi.fn(),
  setSelectedPersonality: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  getHermesPersonalities: mocks.getPersonalities,
  saveHermesPersonality: mocks.savePersonality,
  deleteHermesPersonality: mocks.deletePersonality,
  setSelectedHermesPersonality: mocks.setSelectedPersonality,
}));

vi.mock("@amiba/i18n", () => {
  const t = (key: string, values?: Record<string, string>) =>
    values
      ? Object.entries(values).reduce(
          (text, [name, value]) => text.replace(`{${name}}`, value),
          key,
        )
      : key;
  return { useT: () => ({ t }) };
});

import { AgentPersonalitySection } from "../AgentPersonalitySection";

describe("AgentPersonalitySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPersonalities.mockResolvedValue({
      ok: true,
      personalities: [
        {
          key: "helpful",
          name: "helpful",
          builtin: true,
          overridden: false,
          selected: false,
          preview: "Friendly help",
          description: "",
          prompt: "Be helpful.",
          system_prompt: "Be helpful.",
          tone: "",
          style: "",
        },
      ],
    });
    mocks.savePersonality.mockResolvedValue({ ok: true, key: "helpful" });
    mocks.deletePersonality.mockResolvedValue({
      ok: true,
      reset: true,
      existed: true,
    });
    mocks.setSelectedPersonality.mockResolvedValue({
      ok: true,
      key: "helpful",
    });
  });

  it("marks response modes supplied by the underlying defaults", async () => {
    render(<AgentPersonalitySection profileId="researcher" />);

    await screen.findByRole("button", { name: /helpful/ });
    expect(
      screen.getByText("common.builtin"),
    ).toBeInTheDocument();
  });

  it("does not label a profile replacement as adjusted or built in", async () => {
    mocks.getPersonalities.mockResolvedValue({
      ok: true,
      personalities: [
        {
          key: "helpful",
          name: "helpful",
          builtin: true,
          overridden: true,
          selected: false,
          preview: "Profile-specific help",
          description: "",
          prompt: "Use the profile instructions.",
          system_prompt: "Use the profile instructions.",
          tone: "",
          style: "",
        },
      ],
    });
    const user = userEvent.setup();
    render(<AgentPersonalitySection profileId="researcher" />);

    await user.click(await screen.findByRole("button", { name: /helpful/ }));
    expect(
      screen.queryByText("common.builtin"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("options.agents.personality.overridden"),
    ).not.toBeInTheDocument();
  });

  it("edits a mode in the selected Hermes profile", async () => {
    const user = userEvent.setup();
    render(<AgentPersonalitySection profileId="researcher" />);

    await user.click(await screen.findByRole("button", { name: /helpful/ }));
    const name = screen.getByLabelText("options.agents.personality.name");
    expect(name).toBeEnabled();
    await user.clear(name);
    await user.type(name, "Friendly guide");
    const instruction = screen.getByLabelText(
      "options.agents.personality.instruction",
    );
    await user.clear(instruction);
    await user.type(instruction, "Verify the answer before responding.");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(mocks.savePersonality).toHaveBeenCalledWith(
      "researcher",
      {
        builtin: true,
        description: "",
        existing: true,
        key: "helpful",
        name: "Friendly guide",
        originalKey: "helpful",
        overridden: false,
        style: "",
        system_prompt: "Verify the answer before responding.",
        tone: "",
      },
      "helpful",
    );
    await waitFor(() => {
      expect(mocks.getPersonalities).toHaveBeenCalledTimes(2);
    });
  });

  it("creates a reusable response mode without leaving the agent page", async () => {
    const user = userEvent.setup();
    render(<AgentPersonalitySection profileId="writer" />);

    await screen.findByRole("button", { name: /helpful/ });
    await user.click(
      screen.getByRole("button", {
        name: "options.agents.personality.create",
      }),
    );
    await user.type(
      screen.getByLabelText("options.agents.personality.name"),
      "editor",
    );
    await user.type(
      screen.getByLabelText("options.agents.personality.instruction"),
      "Rewrite for clarity.",
    );
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(mocks.savePersonality).toHaveBeenCalledWith(
      "writer",
      expect.objectContaining({
        key: "editor",
        name: "editor",
        system_prompt: "Rewrite for clarity.",
      }),
      undefined,
    );
  });

  it("renames a custom response mode", async () => {
    mocks.getPersonalities.mockResolvedValue({
      ok: true,
      personalities: [
        {
          key: "reviewer",
          name: "Reviewer",
          builtin: false,
          overridden: true,
          selected: true,
          preview: "Review claims",
          description: "",
          prompt: "Review every claim.",
          system_prompt: "Review every claim.",
          tone: "",
          style: "",
        },
      ],
    });
    const user = userEvent.setup();
    render(<AgentPersonalitySection profileId="researcher" />);

    await user.click(await screen.findByRole("button", { name: /Reviewer/ }));
    const name = screen.getByLabelText("options.agents.personality.name");
    expect(name).toBeEnabled();
    await user.clear(name);
    await user.type(name, "Fact checker");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(mocks.savePersonality).toHaveBeenCalledWith(
      "researcher",
      expect.objectContaining({
        key: "reviewer",
        name: "Fact checker",
        originalKey: "reviewer",
      }),
      "reviewer",
    );
  });

  it("chooses the default response mode for the profile", async () => {
    const user = userEvent.setup();
    render(<AgentPersonalitySection profileId="researcher" />);

    const trigger = await screen.findByRole("combobox", {
      name: "options.agents.personality.defaultLabel",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: "helpful" }));

    expect(mocks.setSelectedPersonality).toHaveBeenCalledWith(
      "researcher",
      "helpful",
    );
  });
});
