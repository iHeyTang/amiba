import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPageScaffold } from "../SettingsPageScaffold";

const mocks = vi.hoisted(() => ({
  behaviorProps: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getProfiles: vi.fn(),
  renameProfile: vi.fn(),
  setActiveProfile: vi.fn(),
}));

vi.mock("@amiba/app-runtime/core", () => ({
  createAgentPreset: mocks.createProfile,
  deleteAgentPreset: mocks.deleteProfile,
  getAgentPresets: mocks.getProfiles,
  normalizeAgentPresetId: (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, "-"),
  renameAgentPreset: mocks.renameProfile,
  setDefaultAgentPreset: mocks.setActiveProfile,
}));

vi.mock("../AgentBehaviorEditor", () => ({
  AgentBehaviorEditor: (props: Record<string, unknown>) => {
    mocks.behaviorProps(props);
    return <div data-testid="behavior-editor" />;
  },
}));

vi.mock("../../skills", () => ({
  SkillsPage: ({
    embedded,
    profileId,
  }: {
    embedded?: boolean;
    profileId?: string;
  }) => (
    <div data-embedded={String(embedded)} data-testid="profile-skills">
      {profileId}
    </div>
  ),
}));

vi.mock("../../usage", () => ({
  ToolsPage: ({
    embedded,
    profileId,
  }: {
    embedded?: boolean;
    profileId?: string;
  }) => (
    <div data-embedded={String(embedded)} data-testid="profile-capabilities">
      {profileId}
    </div>
  ),
}));

import { SettingsAgentsPage } from "../SettingsAgentsPage";

function profile(
  name: string,
  description = "Verifies product claims",
  isDefault = false,
  trust: "system" | "user" = "user",
) {
  return {
    name,
    path: isDefault ? "/root/.dsh" : `/presets/${name}`,
    is_default: isDefault,
    model: "test-model",
    provider: "deepseek",
    has_env: false,
    skill_count: 3,
    description,
    description_auto: false,
    distribution_name: null,
    distribution_version: null,
    distribution_source: null,
    soul_exists: true,
    trust,
  };
}

function profilesResponse(name: string, description?: string) {
  return {
    ok: true,
    profiles: [
      profile("default", "Root assistant", false, "system"),
      profile(name, description, true),
    ],
    active: name,
    current: name,
  };
}

function renderPage(props: {
  detail?: string;
  onOpenDetail: (id: string | null) => void;
  presetSections?: readonly { id: string; label: string }[];
  renderPresetSection?: (
    sectionId: string,
    owner: { profileId: string },
  ) => ReactNode;
}) {
  return render(
    <SettingsPageScaffold title="Agents" scroll="self">
      <SettingsAgentsPage {...props} />
    </SettingsPageScaffold>,
  );
}

describe("SettingsAgentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockResolvedValue(profilesResponse("researcher"));
    mocks.renameProfile.mockResolvedValue({ ok: true });
    mocks.deleteProfile.mockResolvedValue({ ok: true });
    mocks.setActiveProfile.mockResolvedValue({ ok: true });
    mocks.createProfile.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists presets and drills in on click", async () => {
    const onOpenDetail = vi.fn();
    renderPage({ onOpenDetail });

    const row = await screen.findByRole("button", { name: /researcher/ });
    await userEvent.click(row);
    expect(onOpenDetail).toHaveBeenCalledWith("researcher");
  });

  it("shows the preset name in the head with a back affordance on detail", async () => {
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    expect(
      await screen.findByRole("heading", { name: "researcher" }),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onOpenDetail).toHaveBeenCalledWith(null);
  });

  it("falls back to the list when the detail id does not exist", async () => {
    const onOpenDetail = vi.fn();
    renderPage({ detail: "ghost", onOpenDetail });

    await waitFor(() => expect(onOpenDetail).toHaveBeenCalledWith(null));
  });

  it("shows the empty state when there are no custom presets and lets create from it", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      profiles: [profile("default", "Root assistant", false, "system")],
      active: "default",
      current: "default",
    });
    const onOpenDetail = vi.fn();
    renderPage({ onOpenDetail });

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
    const onOpenDetail = vi.fn();
    renderPage({ onOpenDetail });

    await screen.findByRole("button", { name: /researcher/ });
    await userEvent.click(
      screen.getByRole("button", { name: "New agent preset" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("Preset name"),
      "writer",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "New agent preset" }),
    );

    await waitFor(() => {
      expect(mocks.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: "writer" }),
      );
    });
    expect(onOpenDetail).toHaveBeenCalledWith("writer");
  });

  it("activates a non-default preset from the detail actions", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
      current: "default",
    });
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    const activate = await screen.findByRole("button", {
      name: "Make default task preset",
    });
    await userEvent.click(activate);
    await waitFor(() => {
      expect(mocks.setActiveProfile).toHaveBeenCalledWith("researcher");
    });
  });

  it("surfaces a failed preset action inline on the detail page without navigating away", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
      current: "default",
    });
    mocks.setActiveProfile.mockResolvedValue({
      ok: false,
      error: "Could not reach the DSH settings service.",
    });
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    const activate = await screen.findByRole("button", {
      name: "Make default task preset",
    });
    await userEvent.click(activate);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not reach the DSH settings service.",
    );
    expect(screen.getByRole("heading", { name: "researcher" })).toBeVisible();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it("renames the preset from the detail page and requests navigation to the new id", async () => {
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    await screen.findByRole("heading", { name: "researcher" });
    await userEvent.click(
      screen.getByRole("button", { name: "Rename agent preset" }),
    );
    const nameInput = screen.getByRole("textbox", { name: "Preset name" });
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "writer{Enter}");

    await waitFor(() => {
      expect(mocks.renameProfile).toHaveBeenCalledWith("researcher", "writer");
    });
    await waitFor(() => {
      expect(onOpenDetail).toHaveBeenCalledWith("writer");
    });
  });

  it("deletes the preset from the detail page and returns to the list", async () => {
    mocks.getProfiles.mockResolvedValue({
      ok: true,
      profiles: [
        profile("default", "Root assistant", false, "system"),
        profile("researcher"),
      ],
      active: "default",
      current: "default",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    await screen.findByRole("heading", { name: "researcher" });
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mocks.deleteProfile).toHaveBeenCalledWith("researcher");
    });
    await waitFor(() => {
      expect(onOpenDetail).toHaveBeenCalledWith(null);
    });
  });

  it("scopes the embedded workspace pages to the selected preset", async () => {
    const onOpenDetail = vi.fn();
    renderPage({ detail: "researcher", onOpenDetail });

    await screen.findByTestId("behavior-editor");
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Verifies product claims",
        profileId: "researcher",
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: "Skills" }));
    expect(await screen.findByTestId("profile-skills")).toHaveTextContent(
      "researcher",
    );
    expect(screen.getByTestId("profile-skills")).toHaveAttribute(
      "data-embedded",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(await screen.findByTestId("profile-capabilities")).toHaveTextContent(
      "researcher",
    );
  });

  it("renders a tab per ledger-registered preset section and forwards the profileId to its render callback", async () => {
    const onOpenDetail = vi.fn();
    const renderPresetSection = vi.fn(
      (sectionId: string, owner: { profileId: string }) => (
        <div data-testid="preset-section">
          {sectionId}:{owner.profileId}
        </div>
      ),
    );
    renderPage({
      detail: "researcher",
      onOpenDetail,
      presetSections: [{ id: "x", label: "X" }],
      renderPresetSection,
    });

    await screen.findByTestId("behavior-editor");
    const tab = screen.getByRole("button", { name: "X" });
    await userEvent.click(tab);

    expect(await screen.findByTestId("preset-section")).toHaveTextContent(
      "x:researcher",
    );
    expect(renderPresetSection).toHaveBeenLastCalledWith("x", {
      profileId: "researcher",
    });
  });

  it("renders a ledger-registered 'memory' section as an ordinary tab now that memory is fully plugin-owned", async () => {
    const onOpenDetail = vi.fn();
    const renderPresetSection = vi.fn(() => (
      <div data-testid="ledger-memory" />
    ));
    renderPage({
      detail: "researcher",
      onOpenDetail,
      presetSections: [{ id: "memory", label: "Memory" }],
      renderPresetSection,
    });

    await screen.findByTestId("behavior-editor");
    const memoryTabs = screen.getAllByRole("button", { name: "Memory" });
    expect(memoryTabs).toHaveLength(1);

    await userEvent.click(memoryTabs[0]);

    expect(await screen.findByTestId("ledger-memory")).toBeInTheDocument();
    expect(renderPresetSection).toHaveBeenLastCalledWith("memory", {
      profileId: "researcher",
    });
  });

  it("ignores a ledger section claiming the reserved 'behavior' id", async () => {
    const onOpenDetail = vi.fn();
    const renderPresetSection = vi.fn(() => (
      <div data-testid="ledger-behavior" />
    ));
    renderPage({
      detail: "researcher",
      onOpenDetail,
      presetSections: [{ id: "behavior", label: "Ledger Behavior" }],
      renderPresetSection,
    });

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
  });
});
