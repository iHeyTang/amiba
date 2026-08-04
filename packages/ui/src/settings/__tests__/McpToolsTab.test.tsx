import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getHermesInstalledMcps: vi.fn(),
}));

vi.mock("@amiba/core", () => core);

import { McpToolsTab } from "../McpToolsTab";

describe("McpToolsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    core.getHermesInstalledMcps.mockResolvedValue({
      ok: true,
      items: [
        {
          slug: "filesystem",
          label: "Filesystem",
          description: "Access selected local folders.",
          source: "curated",
          installed: true,
          enabled: true,
          transport_kind: "stdio",
        },
      ],
    });
  });

  it("presents MCP as a profile-scoped source of tools", async () => {
    render(<McpToolsTab profileId="researcher" />);

    expect(await screen.findByText("Filesystem")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Connect tools provided by external services through MCP.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("External tools")).toBeInTheDocument();
    expect(screen.queryByText("Shared at runtime")).not.toBeInTheDocument();
    expect(screen.getByText("MCP · stdio")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(core.getHermesInstalledMcps).toHaveBeenCalledWith("researcher");
  });
});
