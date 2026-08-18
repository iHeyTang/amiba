import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { McpToolsTab } from "../McpToolsTab";

const list = vi.fn();

describe("McpToolsTab DSH plugin", () => {
  beforeEach(() => {
    list.mockResolvedValue({
      toolsOnly: true,
      servers: [{
        serverName: "filesystem",
        transport: "stdio",
        enabled: true,
        command: "mcp-filesystem",
        args: [],
        envKeys: [],
        headerKeys: [],
      }],
    });
    setPlatform({
      storage: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn(), watch: vi.fn(() => () => {}) },
      agentMcp: { list, save: vi.fn(), remove: vi.fn() },
    } as unknown as PlatformAdapter);
  });

  it("lists MCP tool providers composed as DSH plugins", async () => {
    render(<McpToolsTab />);
    expect(await screen.findByText("filesystem")).toBeVisible();
    expect(screen.getByText(/DSH MCP/)).toHaveTextContent("STDIO");
    expect(list).toHaveBeenCalled();
  });
});
