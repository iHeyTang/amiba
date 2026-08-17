import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";

import { DshSkillsPage } from "../DshSkillsPage";

vi.mock("@amiba/app-runtime/core", () => ({
  getAgentPresets: vi.fn().mockResolvedValue({
    ok: true,
    active: "default",
    profiles: [],
  }),
  useSessions: () => ({ activeId: "session-1" }),
}));

const listSkills = vi.fn();
const listFiles = vi.fn();
const readSkillFile = vi.fn();

describe("DshSkillsPage visual contract", () => {
  beforeEach(() => {
    listSkills.mockResolvedValue({
      userRoot: "/tmp/dsh/skills",
      skills: [
        {
          name: "research-brief",
          description: "Prepare a sourced research brief",
          whenToUse: "Use for research requests.",
          editable: true,
          userInvocable: true,
          modelInvocable: true,
          source: "user-dsh",
          provider: "filesystem:user-dsh",
          resourceBase: { kind: "directory", path: "/tmp/dsh/skills/research-brief" },
        },
        {
          name: "workspace-tools",
          description: "Built-in workspace workflow",
          whenToUse: "Use for workspace changes.",
          editable: false,
          userInvocable: false,
          modelInvocable: true,
          source: "runtime",
          provider: "workspace-plugin",
          resourceBase: { kind: "opaque", description: "workspace-plugin" },
        },
      ],
    });
    listFiles.mockResolvedValue({
      root: "workspace-plugin",
      files: [{ path: "SKILL.md", size: 36 }],
      truncated: false,
    });
    readSkillFile.mockResolvedValue({
      path: "SKILL.md",
      size: 36,
      encoding: "utf-8",
      content: "# Workspace tools\n\nBuilt-in workflow.\n",
    });
    setPlatform({
      storage: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn(),
        remove: vi.fn(),
        watch: vi.fn(() => () => {}),
      },
      agentSkills: {
        list: listSkills,
        read: vi.fn(),
        listFiles,
        readFile: readSkillFile,
        save: vi.fn(),
        remove: vi.fn(),
      },
      agentSessions: {
        list: vi.fn().mockResolvedValue([
          {
            sessionId: "session-1",
            title: "Main session",
            createdAt: 1,
            updatedAt: 2,
            agentPreset: "default",
          },
        ]),
      },
    } as unknown as PlatformAdapter);
  });

  it("matches the Tools directory layout while keeping DSH-specific filters and inspection", async () => {
    const user = userEvent.setup();
    render(
      <DshSkillsPage
        adapter={{
          list: listSkills,
          read: vi.fn(),
          listFiles,
          readFile: readSkillFile,
          save: vi.fn(),
          remove: vi.fn(),
        }}
        sessionId="session-1"
      />,
    );

    expect(await screen.findByText("research-brief")).toBeVisible();
    expect(screen.getByRole("group", { name: "Sources" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Model callable 2/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /User callable 1/ })).toBeVisible();
    expect(screen.getByText("Prepare a sourced research brief")).toBeVisible();
    expect(screen.getByText("workspace-tools")).toBeVisible();
    expect(listSkills).toHaveBeenCalledWith("session-1");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Composed DSH skills")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^User 1$/ }));
    await waitFor(() => {
      expect(screen.queryByText("workspace-tools")).not.toBeInTheDocument();
    });
    expect(screen.getByText("research-brief")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /All 2/ }));
    await user.click(await screen.findByText("workspace-tools"));
    await waitFor(() => {
      expect(listFiles).toHaveBeenCalledWith("workspace-tools", "session-1");
      expect(readSkillFile).toHaveBeenCalledWith(
        "workspace-tools",
        "SKILL.md",
        "session-1",
      );
    });
    expect(await screen.findByText(/Built-in workflow\./)).toBeVisible();
  });

  it("portals the Create action into the settings page's header actions host", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      <DshSkillsPage
        adapter={{
          list: listSkills,
          read: vi.fn(),
          listFiles,
          readFile: readSkillFile,
          save: vi.fn(),
          remove: vi.fn(),
        }}
        headerActionsHost={() => host}
        sessionId="session-1"
      />,
    );

    const createButton = await screen.findByRole("button", {
      name: "Create skill",
    });
    expect(host).toContainElement(createButton);

    host.remove();
  });
});
