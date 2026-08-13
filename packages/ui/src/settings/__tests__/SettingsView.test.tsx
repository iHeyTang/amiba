import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@amiba/extension-host/renderer", () => ({
  ExtensionWebView: () => null,
  useExtensionSettings: () => [],
  useExtensionRegistry: () => [],
  desktopBridge: () => ({
    extensions: { onExtensionsChanged: () => () => {} },
  }),
}));

vi.mock("@amiba/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@amiba/core")>();
  return {
    ...actual,
    getHermesPlugins: vi.fn().mockResolvedValue({ ok: true, plugins: [] }),
  };
});

vi.mock("../HermesModelConfigTab", () => ({
  HermesModelConfigTab: ({
    view,
    selectedProfileId,
  }: {
    view: string;
    selectedProfileId?: string;
  }) => (
    <div data-testid="model-settings-view">
      {view}:{selectedProfileId || "unscoped"}
    </div>
  ),
}));

vi.mock("../SettingsAgents", () => ({
  SettingsAgents: ({ initialSection }: { initialSection?: string }) => (
    <div data-testid="agent-settings-view">{initialSection || "behavior"}</div>
  ),
}));

vi.mock("../AgentBehaviorEditor", () => ({
  SettingsAssistantBehavior: () => (
    <div data-testid="assistant-behavior-view">default</div>
  ),
}));

import { SettingsView } from "../SettingsView";
import { APP_SIDEBAR_DEFAULT_WIDTH } from "../../navigation/sidebar-layout";

describe("SettingsView progressive settings navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#models");
  });

  it("keeps default model settings ordinary and agent scopes behind Advanced", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    expect(screen.getByTestId("settings-sidebar")).toHaveStyle({
      width: `${APP_SIDEBAR_DEFAULT_WIDTH}px`,
    });

    const models = screen.getByRole("button", {
      name: "Models & services",
    });
    const collaboration = screen.getByRole("button", {
      name: "Multi-model collaboration",
    });
    const behavior = screen.getByRole("button", {
      name: "Behavior & identity",
    });
    const advanced = screen.getByRole("button", { name: "Advanced" });
    const usage = screen.getByRole("button", { name: "Tokens" });
    const voice = screen.getByRole("button", { name: "Voice" });
    const assistantSection = screen.getByText("Assistant");

    expect(models).toHaveAttribute("aria-current", "page");
    expect(usage).toBeVisible();
    expect(
      voice.compareDocumentPosition(assistantSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("model-settings-view")).toHaveTextContent(
      "models:default",
    );
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Agent presets" }),
    ).not.toBeInTheDocument();
    expect(collaboration).toBeVisible();
    expect(behavior).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Capability extensions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Applets" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Connection" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Diagnostics")).not.toBeInTheDocument();

    await user.click(collaboration);
    expect(collaboration).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("model-settings-view")).toHaveTextContent(
      "multi-model-collaboration:default",
    );
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(window.location.hash).toBe("#multi-model-collaboration");

    await user.click(behavior);
    expect(behavior).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("assistant-behavior-view")).toHaveTextContent(
      "default",
    );
    expect(window.location.hash).toBe("#behavior");

    await user.click(advanced);
    expect(advanced).toHaveAttribute("aria-expanded", "true");
    const agents = screen.getByRole("button", { name: "Agent presets" });
    expect(screen.getByRole("button", { name: "Status" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connection" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Logs" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Hermes Runtime" }),
    ).not.toBeInTheDocument();
    await user.click(agents);

    expect(agents).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("agent-settings-view")).toHaveTextContent(
      "behavior",
    );
    expect(window.location.hash).toBe("#agents");

    await user.click(models);
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Agent presets" }),
    ).not.toBeInTheDocument();
  });

  it("routes the collaboration hash into the default profile panel", () => {
    window.history.replaceState(null, "", "/#multi-model-collaboration");
    render(<SettingsView />);

    expect(screen.getByRole("button", { name: "Advanced" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Multi-model collaboration" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("model-settings-view")).toHaveTextContent(
      "multi-model-collaboration:default",
    );
  });

  it("renders Home as the first sidebar destination", async () => {
    const user = userEvent.setup();
    const onGoHome = vi.fn();
    render(<SettingsView onGoHome={onGoHome} />);

    const goHome = screen.getByRole("button", { name: "Back to home" });
    const general = screen.getByText("General");

    expect(
      goHome.compareDocumentPosition(general) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(goHome);
    expect(onGoHome).toHaveBeenCalledOnce();
  });
});
