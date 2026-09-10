import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshMcpToolsTab } from "../DshMcpToolsTab";

const list = vi.fn();

describe("DshMcpToolsTab DSH plugin", () => {
  beforeEach(() => {
    list.mockResolvedValue({
      toolsOnly: true,
      servers: [
        {
          serverName: "filesystem",
          transport: "stdio",
          enabled: true,
          command: "mcp-filesystem",
          args: [],
          envKeys: [],
          headerKeys: [],
        },
      ],
    });
  });

  it("lists MCP tool providers composed as DSH plugins", async () => {
    render(
      <DshMcpToolsTab adapter={{ list, save: vi.fn(), remove: vi.fn() }} />,
    );
    expect(await screen.findByText("filesystem")).toBeVisible();
    expect(screen.getByText(/MCP ·/)).toHaveTextContent("STDIO");
    expect(list).toHaveBeenCalled();
  });
});

it("shows plugin ownership and consumers without configuration or instance identifiers", async () => {
  list.mockResolvedValue({
    toolsOnly: true,
    servers: [],
    dependencies: [
      {
        connectionId: "private-id",
        name: "Work",
        service: "Feishu",
        provider: "Feishu connector",
        consumers: ["Knowledge", "Documents"],
        instances: 1,
        state: "in-use",
      },
    ],
  });
  render(<DshMcpToolsTab adapter={{ list, save: vi.fn(), remove: vi.fn() }} />);
  expect(await screen.findByText("Feishu · Work")).toBeVisible();
  expect(screen.getByText(/Knowledge、Documents/)).toBeVisible();
  expect(screen.getByText(/Feishu connector/)).toBeVisible();
  expect(screen.queryByText("private-id")).not.toBeInTheDocument();
});
