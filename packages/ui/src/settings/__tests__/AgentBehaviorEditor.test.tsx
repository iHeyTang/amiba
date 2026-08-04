import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfiles: vi.fn(),
  getSoul: vi.fn(),
  updateDescription: vi.fn(),
  updateSoul: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  getHermesProfiles: mocks.getProfiles,
  getHermesProfileSoul: mocks.getSoul,
  updateHermesProfileDescription: mocks.updateDescription,
  updateHermesProfileSoul: mocks.updateSoul,
}));

vi.mock("@amiba/i18n", () => {
  const t = (key: string) => key;
  return { useT: () => ({ t }) };
});

vi.mock("../AgentPersonalitySection", () => ({
  AgentPersonalitySection: ({ profileId }: { profileId: string }) => (
    <div data-testid="personality-section">{profileId}</div>
  ),
}));

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
    expect(screen.getByTestId("personality-section")).toHaveTextContent(
      "researcher",
    );
  });

  it("maps the Assistant-level page to the root default configuration", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      active: "default",
      current: "default",
      profiles: [
        {
          name: "default",
          is_default: true,
          description: "Root assistant",
        },
      ],
    });

    render(<SettingsAssistantBehavior />);

    await waitFor(() => {
      expect(mocks.getSoul).toHaveBeenCalledWith("default");
    });
    expect(
      await screen.findByDisplayValue("Root assistant"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("personality-section")).toHaveTextContent(
      "default",
    );
  });
});
