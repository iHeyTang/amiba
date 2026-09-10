import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SettingsPageChromeProvider,
  useSettingsPageChrome,
} from "@amiba/ui/plugin";

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
  type RenderPresetSection,
  type SnapshotSource,
} from "../DshAgentPresetsPage.js";
import type { AgentPreset, AgentPresetsAdapter } from "../data.js";

function profile(
  name: string,
  description = "Verifies product claims",
  isDefault = false,
  trust: "system" | "user" = "user",
): AgentPreset {
  return { id: name, name, is_default: isDefault, description, trust };
}

/**
 * The deployment's real wire shape: the shipped `standard` preset carries
 * `system` trust and `isDefault` (the api-proxy stamps `isDefault:
 * preset.id === defaultId`, and the shipped config sets `default:
 * standard`), plus one independent user copy.
 */
function response(name: string, description?: string) {
  return {
    ok: true,
    profiles: [
      profile("standard", "Root assistant", true, "system"),
      profile(name, description),
    ],
    active: "standard",
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

/** Reproduces the settings scaffold's chrome half: the page renders in the
 *  same React tree as the scaffold, so SettingsPageActions resolves the
 *  head-actions host from plain context. */
function ActionsHost() {
  const { setActionsHost } = useSettingsPageChrome();
  return <div data-testid="actions-host" ref={setActionsHost} />;
}

function renderPage(options?: {
  presetSections?: readonly PresetSectionRow[];
  renderPresetSection?: RenderPresetSection;
}) {
  return render(
    <SettingsPageChromeProvider>
      <ActionsHost />
      <DshAgentPresetsPage
        adapter={adapter as unknown as AgentPresetsAdapter}
        presetSections={sectionsSource(options?.presetSections)}
        renderPresetSection={options?.renderPresetSection}
      />
    </SettingsPageChromeProvider>,
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
  });

  it("shows all four official presets regardless of trust", async () => {
    adapter.getAgentPresets.mockResolvedValue({ ok: true, active: "standard", profiles: [
      profile("standard", "Standard", true, "system"),
      profile("code", "Code Mode", false, "system"),
      profile("minimal", "Minimal", false, "system"),
      profile("cordis", "Create", false, "system"),
    ] });
    renderPage();
    for (const name of ["standard", "code", "minimal", "cordis"]) {
      expect(await screen.findByRole("button", { name: new RegExp(name) })).toBeVisible();
    }
  });

  it("displays the official name but opens the composition using its id", async () => {
    adapter.getAgentPresets.mockResolvedValue({ ok: true, active: "standard", profiles: [
      { ...profile("standard", "Standard", true, "system"), name: "标准模式" },
    ] });
    renderPage();
    await drillIn("标准模式");
    expect(await screen.findByTestId("behavior-editor")).toBeVisible();
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ profileId: "standard" }),
    );
  });

  it("pins the current default preset as the first row with the Default badge", async () => {
    renderPage();

    const defaultRow = await screen.findByRole("button", {
      name: /standard/,
    });
    // Badge idiom shared with the detail head — the wire's `isDefault`
    // entry is surfaced, not a hardcoded id.
    expect(within(defaultRow).getByText("Default")).toBeVisible();
    const copyRow = screen.getByRole("button", { name: /researcher/ });
    expect(within(copyRow).queryByText("Default")).not.toBeInTheDocument();
    expect(
      defaultRow.compareDocumentPosition(copyRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("drills into the pinned default row read-only: no rename, no delete, no set-default", async () => {
    renderPage();
    await drillIn("standard");

    expect(await screen.findByTestId("behavior-editor")).toBeInTheDocument();
    // The folded-in 行为与人设 contract: the default preset's behavior
    // projection, Edit-source affordance suppressed.
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Root assistant",
        profileId: "standard",
        sourceEditable: false,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Rename agent preset" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make default task preset" }),
    ).not.toBeInTheDocument();
    // It already IS the default — the actions area shows the badge instead.
    expect(screen.getByText("Default")).toBeVisible();
  });

  it("dispatches the ledger tab's render prop scoped to the default preset's wire id", async () => {
    const renderPresetSection = vi.fn<RenderPresetSection>(
      (sectionId, owner) => (
        <div
          data-testid="preset-section"
          data-section={sectionId}
          data-profile={owner.profileId}
        />
      ),
    );
    renderPage({
      presetSections: [{ id: "skills", label: "Skills" }],
      renderPresetSection,
    });
    await drillIn("standard");

    await screen.findByTestId("behavior-editor");
    await userEvent.click(screen.getByRole("button", { name: "Skills" }));

    const section = await screen.findByTestId("preset-section");
    expect(section).toHaveAttribute("data-section", "skills");
    expect(section).toHaveAttribute("data-profile", "standard");
    expect(renderPresetSection).toHaveBeenLastCalledWith("skills", {
      profileId: "standard",
    });
  });

  it("pins a user copy holding the default slot exactly once and guards its drill-in", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [
        profile("standard", "Root assistant", false, "system"),
        profile("researcher", "Verifies product claims", true),
      ],
      active: "researcher",
    });
    renderPage();

    // One preset, one row: the defaulted copy appears only as the pinned
    // row, never duplicated in the independent list below.
    const rows = await screen.findAllByRole("button", { name: /researcher/ });
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText("Default")).toBeVisible();

    await userEvent.click(rows[0]);
    await screen.findByTestId("behavior-editor");
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        profileId: "researcher",
        sourceEditable: false,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Rename agent preset" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
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

  it("keeps the pinned default row above the independent empty state and lets create from it", async () => {
    adapter.getAgentPresets.mockResolvedValue({
      ok: true,
      profiles: [profile("standard", "Root assistant", true, "system")],
      active: "standard",
    });
    renderPage();

    // The empty state refers only to the independent presets below the
    // pinned default row — the default preset is still present and shown.
    expect(await screen.findByRole("button", { name: /standard/ })).toBeVisible();
    expect(screen.getByText("No other agent presets")).toBeVisible();
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

  it("renames a non-default copy from the detail page and stays on the renamed detail", async () => {
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

  it("scopes the embedded behavior editor to the selected copy with the Edit affordance intact", async () => {
    renderPage();
    await drillIn();

    await screen.findByTestId("behavior-editor");
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Verifies product claims",
        profileId: "researcher",
        sourceEditable: true,
      }),
    );
  });

  it("renders a tab per ledger section and dispatches its render prop scoped to the preset", async () => {
    const renderPresetSection = vi.fn<RenderPresetSection>(
      (sectionId, owner) => (
        <div
          data-testid="preset-section"
          data-section={sectionId}
          data-profile={owner.profileId}
        />
      ),
    );
    renderPage({
      presetSections: [{ id: "skills", label: "Skills" }],
      renderPresetSection,
    });
    await drillIn();

    await screen.findByTestId("behavior-editor");
    const tab = screen.getByRole("button", { name: "Skills" });
    await userEvent.click(tab);

    // The plugin does not render ledger content itself: the owning
    // contribution arrives through the renderSlot-backed render prop, scoped
    // to this preset by the owner argument.
    const section = await screen.findByTestId("preset-section");
    expect(section).toHaveAttribute("data-section", "skills");
    expect(section).toHaveAttribute("data-profile", "researcher");
    expect(renderPresetSection).toHaveBeenLastCalledWith("skills", {
      profileId: "researcher",
    });
    expect(screen.queryByTestId("behavior-editor")).not.toBeInTheDocument();
  });

  it("ignores a ledger section claiming the reserved 'behavior' id", async () => {
    const renderPresetSection = vi.fn<RenderPresetSection>(() => (
      <div data-testid="preset-section" />
    ));
    renderPage({
      presetSections: [{ id: "behavior", label: "Ledger Behavior" }],
      renderPresetSection,
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
    expect(renderPresetSection).not.toHaveBeenCalled();
    expect(screen.queryByTestId("preset-section")).not.toBeInTheDocument();
  });
});
