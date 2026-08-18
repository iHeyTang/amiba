import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { AgentCapabilitiesPage } from "../AgentCapabilitiesPage";

const listTools = vi.fn();

describe("AgentCapabilitiesPage DSH inventory", () => {
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
            id: "managed-dsh-profile:web",
            name: "DeepSeek Harness",
            packageName: "@deepseek-ai/dsh-base",
            loadMode: "core",
            executionTarget: "dsh-runtime",
            dynamic: false,
          },
        },
        {
          name: "memory_list",
          description: "List durable memory",
          parameters: { type: "object", properties: {} },
          source: {
            kind: "dsh-plugin",
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
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      agentTools: { list: listTools },
      agentMcp: {
        list: vi.fn().mockResolvedValue({ servers: [], toolsOnly: true }),
        save: vi.fn(),
        remove: vi.fn(),
      },
    } as unknown as PlatformAdapter);
  });

  it("shows the complete runtime catalog without selecting a session", async () => {
    const user = userEvent.setup();
    render(<AgentCapabilitiesPage profileId="default" />);
    await screen.findByRole("button", { name: /read_file/ });
    expect(listTools).toHaveBeenCalledWith();
    expect(screen.getAllByText("Registered")).toHaveLength(2);
    const dshSource = screen.getByRole("button", {
      name: /Official DSH capabilities 1/,
    });
    const amibaSource = screen.getByRole("button", {
      name: /Amiba DSH Plugins 1/,
    });
    expect(dshSource).toBeVisible();
    expect(amibaSource).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(amibaSource);
    expect(screen.getByRole("button", { name: /memory_list/ })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /read_file/ }),
    ).not.toBeInTheDocument();

    await user.click(dshSource);
    const filteredTool = screen.getByRole("button", { name: /read_file/ });
    await user.click(filteredTool);
    expect(screen.getByText("Tool source")).toBeVisible();
    expect(screen.getByText("managed-dsh-profile:web")).toBeVisible();
    expect(screen.queryByText("Current session")).not.toBeInTheDocument();
    expect(screen.getByText(/"path"/)).toBeVisible();
  });
});
