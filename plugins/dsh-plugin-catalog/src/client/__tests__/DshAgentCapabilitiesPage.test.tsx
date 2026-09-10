import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DshAgentCapabilitiesPage } from "../DshAgentCapabilitiesPage";

const listTools = vi.fn();

describe("DshAgentCapabilitiesPage DSH inventory", () => {
  beforeEach(() => {
    listTools.mockResolvedValue({
      tools: [
        {
          name: "read_file",
          description: "Read a workspace file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
          },
          source: {
            kind: "dsh-core",
            distribution: "builtin",
            id: "managed-dsh-profile:web",
            name: "DeepSeek Harness",
            packageName: "@deepseek-ai/dsh-base",
            loadMode: "core",
            executionTarget: "dsh-runtime",
            dynamic: false,
          },
        },
        {
          name: "memos_search",
          description: "Search durable memory",
          parameters: { type: "object", properties: {} },
          source: {
            kind: "dsh-plugin",
            distribution: "builtin",
            id: "amiba-memory",
            name: "Amiba Memory",
            packageName: "@amiba/dsh-plugin-memory",
            loadMode: "plugin",
            executionTarget: "dsh-runtime",
            dynamic: false,
          },
        },
      ],
    });
  });

  it("shows the complete runtime catalog without selecting a session", async () => {
    const user = userEvent.setup();
    render(<DshAgentCapabilitiesPage adapter={{ list: listTools }} />);
    await screen.findByRole("button", { name: /read_file/ });
    expect(listTools).toHaveBeenCalledWith();
    expect(screen.getAllByText("Registered")).toHaveLength(2);
    const builtin = screen.getByRole("button", { name: /Built-in 2/ });
    expect(builtin).toBeVisible();
    expect(screen.queryByRole("button", { name: /Amiba DSH Plugins/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /User extensions 0/ }));
    expect(screen.queryByRole("button", { name: /read_file/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /memos_search/ })).not.toBeInTheDocument();
    await user.click(builtin);
    expect(screen.getByRole("button", { name: /memos_search/ })).toBeVisible();
    const filteredTool = screen.getByRole("button", { name: /read_file/ });
    await user.click(filteredTool);
    expect(screen.getByText("Tool source")).toBeVisible();
    expect(screen.getByText("managed-dsh-profile:web")).toBeVisible();
    expect(screen.queryByText("Current session")).not.toBeInTheDocument();
    expect(screen.getByText(/"path"/)).toBeVisible();
  });
});

it("groups by service identity, expands tools, and keeps the call ID in details", async () => {
  const user = userEvent.setup();
  const makeTool = (provider: string, raw: string) => ({
    name: `mcp__${provider}__${raw}`,
    description: "Find documents in this account",
    parameters: {},
    source: {
      kind: "mcp-server",
      distribution: "user",
      id: "dsh-mcp-client",
      name: "DSH MCP Client",
      displayName: "Work account",
      provider,
      loadMode: "mcp",
      executionTarget: "external-process",
      dynamic: true,
    },
  });
  listTools.mockResolvedValue({
    tools: [
      makeTool("lark-11111111", "docx_builtin_search"),
      makeTool("lark-11111111", "docx_v1_document_rawContent"),
      makeTool("lark-22222222", "docx_builtin_search"),
    ],
  });
  render(<DshAgentCapabilitiesPage adapter={{ list: listTools }} />);
  await screen.findByText("2 servers · 3 tools");
  const labels = screen.getAllByText("Work account");
  expect(labels).toHaveLength(2);
  const first = labels[0]!.closest("summary")!;
  expect(first.parentElement).not.toHaveAttribute("open");
  await user.click(first);
  expect(first.parentElement).toHaveAttribute("open");
  const tools = first.parentElement!.querySelectorAll("button");
  expect(tools).toHaveLength(2);
  expect(tools[0]).toHaveTextContent("Search documents");
  expect(
    screen.queryByText("mcp__lark-11111111__docx_builtin_search"),
  ).not.toBeInTheDocument();
  await user.click(tools[0]!);
  expect(screen.getByText("Call ID")).toBeVisible();
  expect(
    screen.getByText("mcp__lark-11111111__docx_builtin_search"),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Back to tools" }));
  expect(screen.getByText("2 servers · 3 tools")).toBeVisible();
});

it.each([undefined, "lark-af0c7716"])(
  "hides internal server IDs when the display name is %s",
  async (displayName) => {
    listTools.mockResolvedValue({
      tools: [
        {
          name: "mcp__lark-af0c7716__docx_builtin_search",
          parameters: {},
          source: {
            kind: "mcp-server",
      distribution: "user",
            id: "dsh-mcp-client",
            name: "DSH MCP Client",
            provider: "lark-af0c7716",
            displayName,
            loadMode: "mcp",
            executionTarget: "external-process",
            dynamic: true,
          },
        },
      ],
    });
    render(<DshAgentCapabilitiesPage adapter={{ list: listTools }} />);
    expect(await screen.findByText("Feishu / Lark")).toBeVisible();
    expect(screen.queryByText(/lark-af0c7716/)).not.toBeInTheDocument();
  },
);

it("uses delivery metadata independently of vendor, transport or dynamic loading", async () => {
  const user = userEvent.setup();
  const tool = (name: string, kind: string, distribution?: string, dynamic = false) => ({
    name, parameters: {}, source: { kind, distribution, dynamic, id: name, name,
      loadMode: "plugin", executionTarget: "dsh-runtime" },
  });
  listTools.mockResolvedValue({ tools: [
    tool("official_user_extension", "dsh-core", "user"),
    tool("amiba_builtin_dynamic", "dsh-plugin", "builtin", true),
    tool("amiba_user_extension", "dsh-plugin", "user"),
  ] });
  render(<DshAgentCapabilitiesPage adapter={{ list: listTools }} />);
  await screen.findByRole("button", { name: /Built-in 1/ });
  await user.click(screen.getByRole("button", { name: /User extensions 2/ }));
  expect(screen.getByRole("button", { name: /official_user_extension/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /amiba_user_extension/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /amiba_builtin_dynamic/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Unidentified/ })).not.toBeInTheDocument();
});
