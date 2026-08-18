import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  behaviorProps: vi.fn(),
}));

vi.mock("../AgentPresetBehaviorEditor.js", () => ({
  AgentPresetBehaviorEditor: (props: Record<string, unknown>) => {
    mocks.behaviorProps(props);
    return <div data-testid="behavior-editor" />;
  },
}));

import { DshAgentBehaviorSettingsPage } from "../DshAgentBehaviorSettingsPage.js";
import type { AgentPresetsAdapter } from "../data.js";

function makeAdapter(): {
  [K in keyof AgentPresetsAdapter]: ReturnType<typeof vi.fn>;
} {
  return {
    getAgentPresets: vi.fn(),
    createAgentPreset: vi.fn(),
    renameAgentPreset: vi.fn(),
    deleteAgentPreset: vi.fn(),
    setDefaultAgentPreset: vi.fn(),
    readAgentPresetComposition: vi.fn(),
    openAgentPresetDocument: vi.fn(),
  };
}

let adapter = makeAdapter();

function renderPage() {
  return render(
    <DshAgentBehaviorSettingsPage
      adapter={adapter as unknown as AgentPresetsAdapter}
    />,
  );
}

describe("DshAgentBehaviorSettingsPage", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    vi.clearAllMocks();
    adapter = makeAdapter();
  });

  it("maps the page to the default preset and renders the read-only editor", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      active: "standard",
      profiles: [
        {
          name: "standard",
          is_default: true,
          description: "Root assistant",
          trust: "system",
        },
      ],
    });

    renderPage();

    expect(await screen.findByTestId("behavior-editor")).toBeInTheDocument();
    // Same contract as the retired host `SettingsAssistantBehavior`: the
    // roster's default entry scopes the editor, and the assistant-level page
    // never exposes the Edit-source affordance.
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Root assistant",
        profileId: "standard",
        sourceEditable: false,
      }),
    );
  });

  it("falls back to the 'default' preset id when the roster marks none as default", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      active: "default",
      profiles: [
        {
          name: "default",
          is_default: false,
          description: "",
          trust: "system",
        },
      ],
    });

    renderPage();

    await screen.findByTestId("behavior-editor");
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: "default" }),
    );
  });

  it("surfaces a roster load failure instead of the editor", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: false,
      active: "default",
      profiles: [],
      error: "Could not reach the DSH connection service.",
    });

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the DSH connection service.",
    );
    expect(screen.queryByTestId("behavior-editor")).not.toBeInTheDocument();
  });
});
