import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  behaviorProps: vi.fn(),
}));

vi.mock("../AgentPresetBehaviorEditor.js", () => ({
  AgentPresetBehaviorEditor: (props: Record<string, unknown>) => {
    mocks.behaviorProps(props);
    return <div data-testid="behavior-editor" />;
  },
}));

import {
  DshAgentPresetsPage,
  type PresetSectionRow,
  type SnapshotSource,
} from "../DshAgentPresetsPage.js";
import type { AgentPreset, AgentPresetsAdapter } from "../data.js";

function profile(
  name: string,
  description = "Verifies product claims",
  isDefault = false,
  trust: "system" | "user" = "user",
): AgentPreset {
  return { name, is_default: isDefault, description, trust };
}

function response(name: string, description?: string) {
  return {
    ok: true,
    profiles: [
      profile("default", "Root assistant", false, "system"),
      profile(name, description, true),
    ],
    active: name,
  };
}

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

function sectionsSource(
  rows: readonly PresetSectionRow[] = [],
): SnapshotSource<readonly PresetSectionRow[]> {
  return { getSnapshot: () => rows, subscribe: () => () => {} };
}

let adapter = makeAdapter();
let actionsHost: HTMLElement | null = null;

function renderPage(options?: {
  presetSections?: readonly PresetSectionRow[];
}) {
  // The DSH-section scaffold hands the page a head-actions host getter
  // (`owner.headerActionsHost`); SettingsPageActions portals into it across
  // React roots. Recreate that contract with a plain DOM node.
  actionsHost = document.createElement("div");
  document.body.appendChild(actionsHost);
  return render(
    <DshAgentPresetsPage
      adapter={adapter as unknown as AgentPresetsAdapter}
      headerActionsHost={() => actionsHost}
      presetSections={sectionsSource(options?.presetSections)}
    />,
  );
}

async function drillIn(name = "researcher") {
  const row = await screen.findByRole("button", {
    name: new RegExp(name),
  });
  await userEvent.click(row);
}

describe("DshAgentPresetsPage", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    adapter = makeAdapter();
    adapter.getAgentPresets.mockResolvedValue(response("researcher"));
    adapter.renameAgentPreset.mockResolvedValue({ ok: true });
    adapter.deleteAgentPreset.mockResolvedValue({ ok: true });
    adapter.setDefaultAgentPreset.mockResolvedValue({ ok: true });
    adapter.createAgentPreset.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    actionsHost?.remove();
    actionsHost = null;
  });

  it("lists presets and drills into the detail on click", async () => {
    renderPage();
    await drillIn();
    expect(await screen.findByTestId("behavior-editor")).toBeInTheDocument();
    expect(screen.getByText("researcher")).toBeVisible();
  });

  it("returns to the list from the detail back affordance", async () => {
    renderPage();
    await drillIn();
    await screen.findByTestId("behavior-editor");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      await screen.findByRole("button", { name: /researcher/ }),
    ).toBeVisible();
  });

  it("shows the empty state when there are no custom presets and lets create from it", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [profile("default", "Root assistant", false, "system")],
      active: "default",
    });
    renderPage();

    expect(
      await screen.findByText("No independent agent presets"),
    ).toBeVisible();
    const [createButton] = screen.getAllByRole("button", {
      name: "New agent preset",
    });
    await userEvent.click(createButton);
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("creates a preset from the dialog and drills into the new preset", async () => {
    renderPage();

    await screen.findByRole("button", { name: /researcher/ });
    await userEvent.click(
      screen.getByRole("button", { name: "New agent preset" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Preset name"), "writer");
    adapter.getAgentPresets.mockResolvedValue(response("writer"));
    await userEvent.click(
      within(dialog).getByRole("button", { name: "New agent preset" }),
    );

    await waitFor(() => {
      expect(adapter.createAgentPreset).toHaveBeenCalledWith(
        expect.objectContaining({ name: "writer" }),
      );
    });
    expect(await screen.findByTestId("behavior-editor")).toBeInTheDocument();
  });

  it("activates a non-default preset from the detail actions", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
    });
    renderPage();
    await drillIn();

    const activate = await screen.findByRole("button", {
      name: "Make default task preset",
    });
    await userEvent.click(activate);
    await waitFor(() => {
      expect(adapter.setDefaultAgentPreset).toHaveBeenCalledWith("researcher");
    });
  });

  it("surfaces a failed preset action inline on the detail page without navigating away", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
    });
    adapter.setDefaultAgentPreset.mockResolvedValue({
      ok: false,
      error: "Could not reach the DSH settings service.",
    });
    renderPage();
    await drillIn();

    const activate = await screen.findByRole("button", {
      name: "Make default task preset",
    });
    await userEvent.click(activate);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the DSH settings service.",
    );
    expect(screen.getByTestId("behavior-editor")).toBeInTheDocument();
  });

  it("renames the preset from the detail page and stays on the renamed detail", async () => {
    renderPage();
    await drillIn();

    await screen.findByTestId("behavior-editor");
    adapter.getAgentPresets.mockResolvedValue(response("writer"));
    await userEvent.click(
      screen.getByRole("button", { name: "Rename agent preset" }),
    );
    const nameInput = screen.getByRole("textbox", { name: "Preset name" });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "writer{Enter}");

    await waitFor(() => {
      expect(adapter.renameAgentPreset).toHaveBeenCalledWith(
        "researcher",
        "writer",
      );
    });
    expect(await screen.findByText("writer")).toBeVisible();
  });

  it("deletes the preset from the detail page and returns to the list", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await drillIn();

    await screen.findByTestId("behavior-editor");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(adapter.deleteAgentPreset).toHaveBeenCalledWith("researcher");
    });
    expect(
      await screen.findByRole("button", { name: /researcher/ }),
    ).toBeVisible();
  });

  it("scopes the embedded behavior editor to the selected preset", async () => {
    renderPage();
    await drillIn();

    await screen.findByTestId("behavior-editor");
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Verifies product claims",
        profileId: "researcher",
      }),
    );
  });

  it("renders a tab per ledger section and emits the slot marker scoped to the preset", async () => {
    const { container } = renderPage({
      presetSections: [{ id: "skills", label: "Skills" }],
    });
    await drillIn();

    await screen.findByTestId("behavior-editor");
    const tab = screen.getByRole("button", { name: "Skills" });
    await userEvent.click(tab);

    // The plugin does not render ledger content itself: it emits the marker
    // the ui-shell root scanner portals the owning contribution into.
    await waitFor(() => {
      const marker = container.querySelector(
        '[data-amiba-dsh-slot="amiba.agentPreset.section"]',
      );
      expect(marker).not.toBeNull();
      expect(marker).toHaveAttribute("data-amiba-dsh-slot-only", "skills");
      expect(marker).toHaveAttribute(
        "data-amiba-dsh-profile-id",
        "researcher",
      );
    });
    expect(screen.queryByTestId("behavior-editor")).not.toBeInTheDocument();
  });

  it("ignores a ledger section claiming the reserved 'behavior' id", async () => {
    const { container } = renderPage({
      presetSections: [{ id: "behavior", label: "Ledger Behavior" }],
    });
    await drillIn();

    await screen.findByTestId("behavior-editor");
    // Exactly one "Behavior & identity" tab — the native one; a ledger entry
    // claiming the reserved id never adds a second tab or shadows the body.
    expect(
      screen.getAllByRole("button", { name: "Behavior & identity" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Ledger Behavior" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-amiba-dsh-slot="amiba.agentPreset.section"]'),
    ).toBeNull();
  });
});
