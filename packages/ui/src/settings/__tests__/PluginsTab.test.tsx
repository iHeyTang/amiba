import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getHermesPlugins: vi.fn(),
  setPluginEnabled: vi.fn(),
  uninstallPlugin: vi.fn(),
}));

vi.mock("@amiba/core", () => core);

import { PluginsTab } from "../PluginsTab";

describe("PluginsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.getHermesPlugins.mockResolvedValue({
      ok: true,
      plugins: [
        {
          key: "browser-tools",
          name: "Bundled browser implementation",
          enabled: true,
          source: "bundled",
        },
        {
          key: "my-plugin",
          name: "My added plugin",
          enabled: true,
          source: "user",
        },
      ],
    });
  });

  it("lists user-added plugins without exposing bundled implementations", async () => {
    render(<PluginsTab />);

    expect(await screen.findByText("My added plugin")).toBeInTheDocument();
    expect(
      screen.queryByText("Bundled browser implementation"),
    ).not.toBeInTheDocument();
  });

  it("keeps loading and empty copy in the same state container", async () => {
    let resolvePlugins!: (value: { ok: true; plugins: [] }) => void;
    core.getHermesPlugins.mockReturnValue(
      new Promise((resolve) => {
        resolvePlugins = resolve;
      }),
    );

    render(<PluginsTab showAddAction={false} />);

    const loading = screen.getByText("Loading plugins…").closest("[data-ui]");
    expect(loading).toHaveAttribute("data-ui", "collection-state");
    const loadingClassName = loading?.className;

    resolvePlugins({ ok: true, plugins: [] });

    const empty = (await screen.findByText("No plugins installed")).closest(
      "[data-ui]",
    );
    expect(empty).toHaveAttribute("data-ui", "collection-state");
    expect(empty?.className).toBe(loadingClassName);
  });
});
