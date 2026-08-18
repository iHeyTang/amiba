import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshMcpToolsTab } from "../DshMcpToolsTab";

const list = vi.fn();

describe("DshMcpToolsTab DSH plugin", () => {
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
  });

  it("lists MCP tool providers composed as DSH plugins", async () => {
    render(
      <DshMcpToolsTab adapter={{ list, save: vi.fn(), remove: vi.fn() }} />,
    );
    expect(await screen.findByText("filesystem")).toBeVisible();
    expect(screen.getByText(/DSH MCP/)).toHaveTextContent("STDIO");
    expect(list).toHaveBeenCalled();
  });
});
