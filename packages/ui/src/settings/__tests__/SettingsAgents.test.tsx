import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  behaviorProps: vi.fn(),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getProfiles: vi.fn(),
  modelSettingsProps: vi.fn(),
  renameProfile: vi.fn(),
  setActiveProfile: vi.fn(),
}));

vi.mock("@amiba/core", () => ({
  createHermesProfile: mocks.createProfile,
  deleteHermesProfile: mocks.deleteProfile,
  getHermesProfiles: mocks.getProfiles,
  renameHermesProfile: mocks.renameProfile,
  setActiveHermesProfile: mocks.setActiveProfile,
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

vi.mock("../AgentBehaviorEditor", () => ({
  AgentBehaviorEditor: (props: Record<string, unknown>) => {
    mocks.behaviorProps(props);
    return <div data-testid="behavior-editor" />;
  },
}));

vi.mock("../HermesModelConfigTab", () => ({
  HermesModelConfigTab: (props: Record<string, unknown>) => {
    mocks.modelSettingsProps(props);
    return <div data-testid="model-settings" />;
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

vi.mock("../SettingsMemory", () => ({
  SettingsMemory: ({
    embedded,
    profileId,
  }: {
    embedded?: boolean;
    profileId?: string;
  }) => (
    <div data-embedded={String(embedded)} data-testid="profile-memory">
      {profileId}
    </div>
  ),
}));

import { SettingsAgents } from "../SettingsAgents";

function profile(
  name: string,
  description = "Verifies product claims",
  isDefault = false,
) {
  return {
    name,
    path: isDefault ? "/root/.hermes" : `/profiles/${name}`,
    is_default: isDefault,
    model: "test-model",
    provider: "deepseek",
    has_env: false,
    skill_count: 3,
    gateway_running: false,
    description,
    description_auto: false,
    distribution_name: null,
    distribution_version: null,
    distribution_source: null,
    soul_exists: true,
  };
}

function profilesResponse(name: string, description?: string) {
  return {
    ok: true,
    profiles: [
      profile("default", "Root assistant", true),
      profile(name, description),
    ],
    active: name,
    current: name,
  };
}

describe("SettingsAgents scoped preset editor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProfiles.mockResolvedValue(profilesResponse("researcher"));
    mocks.renameProfile.mockResolvedValue({ ok: true });
    mocks.deleteProfile.mockResolvedValue({ ok: true });
  });

  it("keeps the root default out of Advanced and removes header description editing", async () => {
    render(<SettingsAgents />);

    expect(
      await screen.findByRole("button", {
        name: "options.agents.rename",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("researcher")).toHaveLength(2);
    expect(screen.queryByText("default")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "options.agents.editDescription",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.delete" })).toBeVisible();
  });

  it("uses the same six configuration areas as the root Assistant section", async () => {
    render(<SettingsAgents />);

    expect(
      await screen.findByRole("button", {
        name: "options.agents.section.behavior",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", {
        name: "options.agents.section.models",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "options.models.virtual.navTitle",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "options.nav.skills" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "options.nav.tools" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "options.nav.memory" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "options.agents.section.overview",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "options.agents.section.access",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("behavior-editor")).toBeVisible();
    expect(mocks.behaviorProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        description: "Verifies product claims",
        profileId: "researcher",
      }),
    );
  });

  it("edits only the preset name in the header", async () => {
    const user = userEvent.setup();
    mocks.getProfiles
      .mockResolvedValueOnce(profilesResponse("researcher"))
      .mockResolvedValueOnce(profilesResponse("writer"));
    render(<SettingsAgents />);

    await user.click(
      await screen.findByRole("button", {
        name: "options.agents.rename",
      }),
    );
    const nameInput = screen.getByRole("textbox", {
      name: "options.agents.name",
    });
    await user.clear(nameInput);
    await user.type(nameInput, "writer{Enter}");

    await waitFor(() => {
      expect(mocks.renameProfile).toHaveBeenCalledWith("researcher", "writer");
    });
  });

  it("renders the profile skills page directly without a model-access wrapper", async () => {
    const user = userEvent.setup();
    render(<SettingsAgents />);

    await user.click(
      await screen.findByRole("button", { name: "options.nav.skills" }),
    );

    expect(await screen.findByTestId("profile-skills")).toHaveTextContent(
      "researcher",
    );
    expect(screen.getByTestId("profile-skills")).toHaveAttribute(
      "data-embedded",
      "true",
    );
    expect(
      screen.queryByText("options.agents.access.modelTitle"),
    ).not.toBeInTheDocument();
  });

  it("scopes task capabilities and memory to the selected preset", async () => {
    const user = userEvent.setup();
    render(<SettingsAgents />);

    await user.click(
      await screen.findByRole("button", { name: "options.nav.tools" }),
    );
    expect(await screen.findByTestId("profile-capabilities")).toHaveTextContent(
      "researcher",
    );
    expect(screen.getByTestId("profile-capabilities")).toHaveAttribute(
      "data-embedded",
      "true",
    );

    await user.click(
      screen.getByRole("button", { name: "options.nav.memory" }),
    );
    expect(await screen.findByTestId("profile-memory")).toHaveTextContent(
      "researcher",
    );
    expect(screen.getByTestId("profile-memory")).toHaveAttribute(
      "data-embedded",
      "true",
    );
  });
});
