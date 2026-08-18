import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  getSoul: vi.fn(),
  updateDescription: vi.fn(),
  updateSoul: vi.fn(),
}));

vi.mock("@amiba/app-runtime/core", () => ({
  getAgentPresets: mocks.getProfiles,
  readAgentPresetComposition: mocks.getSoul,
  updateAgentPresetDescription: mocks.updateDescription,
  updateAgentPresetComposition: mocks.updateSoul,
}));

vi.mock("@amiba/i18n", () => {
  const t = (key: string) => key;
  return { useT: () => ({ t }) };
});

import {
  AgentBehaviorEditor,
  SettingsAssistantBehavior,
} from "../AgentBehaviorEditor";

describe("AgentBehaviorEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSoul.mockResolvedValue({
      ok: true,
      content: "Verify every claim.",
      exists: true,
    });
    mocks.updateDescription.mockResolvedValue({ ok: true });
    mocks.updateSoul.mockResolvedValue({ ok: true });
  });

  it("keeps description and durable behavior in one scoped form", async () => {
    const user = userEvent.setup();
    render(
      <AgentBehaviorEditor
        description="Research assistant"
        profileId="researcher"
      />,
    );

    const description = await screen.findByLabelText(
      "options.agents.role.title",
    );
    const soul = await screen.findByPlaceholderText(
      "options.agents.soul.placeholder",
    );
    await user.clear(description);
    await user.type(description, "Evidence reviewer");
    await user.clear(soul);
    await user.type(soul, "Cite primary sources.");
    await user.click(screen.getByRole("button", { name: "common.save" }));

    expect(mocks.updateDescription).toHaveBeenCalledWith(
      "researcher",
      "Evidence reviewer",
    );
    expect(mocks.updateSoul).toHaveBeenCalledWith(
      "researcher",
      "Cite primary sources.",
    );
  });

  it("maps the Assistant-level page to the root default configuration", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "standard",
      current: "standard",
      profiles: [
        {
          name: "standard",
          is_default: true,
          description: "Root assistant",
        },
      ],
    });

    render(<SettingsAssistantBehavior />);

    await waitFor(() => {
      expect(mocks.getSoul).toHaveBeenCalledWith("standard");
    });
    expect(
      await screen.findByDisplayValue("Root assistant"),
    ).toBeInTheDocument();
  });
});
