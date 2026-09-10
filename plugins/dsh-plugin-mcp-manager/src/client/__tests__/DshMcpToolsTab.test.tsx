import type { ReactNode } from "react";
import {
  SettingsPageChromeProvider,
  useSettingsPageChrome,
} from "@amiba/ui/plugin";
import userEvent from "@testing-library/user-event";
import { render as renderUi, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshMcpToolsTab } from "../DshMcpToolsTab";

const list = vi.fn();
function HeaderHost() {
  const { setActionsHost } = useSettingsPageChrome();
  return <header data-testid="settings-head" ref={setActionsHost} />;
}
function render(children: ReactNode) {
  return renderUi(
    <SettingsPageChromeProvider>
      <HeaderHost />
      <main>{children}</main>
    </SettingsPageChromeProvider>,
  );
}

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
      <DshMcpToolsTab
        adapter={{ list, startChat: vi.fn(), save: vi.fn(), remove: vi.fn() }}
      />,
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
        serviceId: "feishu.mcp",
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
  render(
    <DshMcpToolsTab
      adapter={{ list, startChat: vi.fn(), save: vi.fn(), remove: vi.fn() }}
    />,
  );
  expect(await screen.findByText("Feishu")).toBeVisible();
  expect(screen.getByText(/Knowledge、Documents/)).toBeVisible();
  expect(screen.getByText(/Feishu connector/)).toBeVisible();
  expect(screen.getByText("feishu.mcp")).toBeVisible();
  const sections = screen.getAllByRole("region");
  expect(sections.map((section) => section.getAttribute("aria-label"))).toEqual(
    ["Added services", "Plugin-provided MCP services"],
  );
  expect(screen.queryByText("private-id")).not.toBeInTheDocument();
});

it("has one add entry, defaults to Agent setup and offers manual setup in its menu", async () => {
  const user = userEvent.setup();
  const startChat = vi.fn();
  list.mockResolvedValue({ toolsOnly: true, servers: [] });
  render(
    <DshMcpToolsTab
      adapter={{ list, startChat, save: vi.fn(), remove: vi.fn() }}
    />,
  );
  await screen.findByText("No services added yet");
  expect(screen.getAllByRole("button", { name: "Add MCP" })).toHaveLength(1);
  expect(screen.getByTestId("settings-head")).toContainElement(
    screen.getByRole("button", { name: "Add MCP" }),
  );
  expect(screen.getByRole("main")).not.toContainElement(
    screen.getByRole("button", { name: "Add MCP" }),
  );
  await user.click(screen.getByRole("button", { name: "Add MCP" }));
  expect(startChat).toHaveBeenCalledWith(
    expect.stringContaining("Help me connect an MCP service"),
  );
  expect(screen.queryByPlaceholderText("Service name")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "MCP setup options" }));
  await user.click(screen.getByRole("button", { name: /Add manually/ }));
  expect(screen.getByPlaceholderText("Service name")).toBeVisible();
  expect(startChat).toHaveBeenCalledTimes(1);
});
