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
});
