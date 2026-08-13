import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ManagedAppletCreateDialog, ManagedApplets } from "../ManagedApplets"

describe("Managed Applets", () => {
  it("keeps AI-created and locally installed Applets in one filterable library", async () => {
    const user = userEvent.setup()
    const bridge = {
      list: vi.fn().mockResolvedValue([{
        id: "io.amiba.personal.report",
        name: "Weekly report",
        kind: "mcp-app",
        source: "personal-managed",
        tags: [],
        sourceSessionIds: [],
        pinned: false,
        archived: false,
        userStatus: "ready",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }]),
      onChanged: vi.fn(() => () => {}),
    }
    render(
      <ManagedApplets
        bridge={bridge as never}
        installedItems={[{
          id: "io.amiba.local.notes",
          source: "local",
          path: "/apps/notes",
          disabled: false,
          status: "loaded",
          manifest: { id: "io.amiba.local.notes", name: "Notes", version: "1.0.0" },
        }] as never}
        renderInstalledItem={(item) => <li><button type="button">{item.manifest?.name}</button></li>}
      />,
    )

    const library = await screen.findByRole("list")
    expect(within(library).getByText("Weekly report")).toBeInTheDocument()
    expect(within(library).getByText("Notes")).toBeInTheDocument()
    expect(screen.queryByText("Developer-installed Applets")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Local" }))
    expect(screen.queryByText("Weekly report")).not.toBeInTheDocument()
    expect(screen.getByText("Notes")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Created with AI" }))
    expect(screen.getByText("Weekly report")).toBeInTheDocument()
    expect(screen.queryByText("Notes")).not.toBeInTheDocument()
  })

  it("hands an isolated draft workspace to the Agent and records its session", async () => {
    const user = userEvent.setup()
    const attachSession = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn().mockResolvedValue({
      app: { id: "io.amiba.personal.calculator", name: "Calculator" },
      draft: { id: "draft-one", workspacePath: "/managed/worktrees/draft-one" },
      agentPrompt: "Build the calculator",
    })
    const startAgentTask = vi.fn().mockResolvedValue("session-one")
    render(
      <ManagedAppletCreateDialog
        open
        onOpenChange={() => {}}
        bridge={{ create, attachSession } as never}
        startAgentTask={startAgentTask}
      />,
    )

    await user.type(screen.getByLabelText("Name"), "Calculator")
    await user.type(screen.getByLabelText("What should it do?"), "Calculate a mortgage")
    await user.click(screen.getByRole("button", { name: "Ask AI to create it" }))

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        name: "Calculator",
        request: "Calculate a mortgage",
        description: "Calculate a mortgage",
      })
      expect(startAgentTask).toHaveBeenCalledWith("Build the calculator", {
        sourceApp: "Calculator",
        workspacePath: "/managed/worktrees/draft-one",
      })
      expect(attachSession).toHaveBeenCalledWith(
        "io.amiba.personal.calculator",
        "draft-one",
        "session-one",
      )
    })
  })
})
