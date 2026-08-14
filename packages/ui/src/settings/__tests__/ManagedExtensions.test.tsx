import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@amiba/mcp-host/react", () => ({
  McpAppsView: ({ className }: { className?: string }) => (
    <iframe className={className} title="Extension" />
  ),
}))

import { ManagedExtensionCreateDialog, ManagedExtensions } from "../ManagedExtensions"

describe("Managed Extensions", () => {
  it("opens an Extension for use and keeps management as a secondary action", async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    const bridge = {
      list: vi.fn().mockResolvedValue([{
        id: "io.amiba.personal.mortgage-calculator",
        name: "Mortgage calculator",
        kind: "interactive-ui",
        source: "personal-managed",
        tags: [],
        sourceSessionIds: [],
        pinned: false,
        archived: false,
        userStatus: "ready",
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }]),
      listOutputs: vi.fn().mockResolvedValue([]),
      onChanged: vi.fn(() => () => {}),
    }
    render(<ManagedExtensions bridge={bridge as never} view={null} onViewChange={onViewChange} />)

    const appName = await screen.findByText("Mortgage calculator")
    const manageButton = screen.getByRole("button", { name: "Manage Mortgage calculator" })
    const appCard = manageButton.closest("li")
    expect(appCard).toHaveClass("rounded-xl")
    expect(appCard?.querySelector(".lucide-chevron-right")).toBeNull()
    await user.click(appName.closest("button")!)
    expect(onViewChange).toHaveBeenLastCalledWith({
      extensionId: "io.amiba.personal.mortgage-calculator",
      name: "Mortgage calculator",
      mode: "use",
    })

    await user.click(manageButton)
    expect(onViewChange).toHaveBeenLastCalledWith({
      extensionId: "io.amiba.personal.mortgage-calculator",
      name: "Mortgage calculator",
      mode: "manage",
    })
  })

  it("keeps AI-created and locally installed Extensions in one filterable library", async () => {
    const user = userEvent.setup()
    const bridge = {
      list: vi.fn().mockResolvedValue([{
        id: "io.amiba.personal.report",
        name: "Weekly report",
        kind: "mcp-extension",
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
      <ManagedExtensions
        bridge={bridge as never}
        installedItems={[{
          id: "io.amiba.local.notes",
          source: "local",
          path: "/extensions/notes",
          disabled: false,
          status: "loaded",
          manifest: { id: "io.amiba.local.notes", name: "Notes", version: "1.0.0" },
        }] as never}
        renderInstalledItem={(item) => <li><button type="button">{item.manifest?.name}</button></li>}
      />,
    )

    const library = await screen.findByRole("list")
    expect(screen.queryByText("My Extensions")).not.toBeInTheDocument()
    expect(within(library).getByText("Weekly report")).toBeInTheDocument()
    expect(within(library).getByText("Notes")).toBeInTheDocument()
    expect(screen.queryByText("Developer-installed Extensions")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Local" }))
    expect(screen.queryByText("Weekly report")).not.toBeInTheDocument()
    expect(screen.getByText("Notes")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Created with AI" }))
    expect(screen.getByText("Weekly report")).toBeInTheDocument()
    expect(screen.queryByText("Notes")).not.toBeInTheDocument()
  })

  it("keeps Extension scrolling inside a clipped host viewport", async () => {
    const bridge = {
      list: vi.fn().mockResolvedValue([{
        id: "io.amiba.personal.mortgage-calculator",
        name: "Mortgage calculator",
        kind: "interactive-ui",
        source: "personal-managed",
        tags: [],
        sourceSessionIds: [],
        pinned: false,
        archived: false,
        userStatus: "ready",
        activeRevisionId: "revision-one",
        activeRevision: {
          id: "revision-one",
          permissions: [],
          manifest: {
            surfaces: {
              main: { resourceUri: "ui://mortgage/main", entry: "ui/index.html" },
            },
          },
        },
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
      }]),
      surface: vi.fn().mockResolvedValue({ html: "<!doctype html><html></html>" }),
      markUsed: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn(() => () => {}),
    }

    render(
      <ManagedExtensions
        bridge={bridge as never}
        view={{
          extensionId: "io.amiba.personal.mortgage-calculator",
          name: "Mortgage calculator",
          mode: "use",
        }}
      />,
    )

    const frame = await screen.findByTitle("Extension")
    const frameViewport = frame.parentElement
    const surfaceViewport = frameViewport?.parentElement
    const detail = surfaceViewport?.parentElement
    const hostShell = detail?.parentElement

    expect(frame).toHaveClass("block", "h-full", "w-full")
    expect(frameViewport).toHaveClass("h-full", "overflow-hidden")
    expect(surfaceViewport).toHaveClass("h-0", "min-h-0", "flex-1", "overflow-hidden")
    expect(detail).toHaveClass("h-full", "min-h-0", "overflow-hidden")
    expect(hostShell).toHaveClass("h-0", "min-h-0", "flex-1", "overflow-hidden")
  })

  it("hands an isolated draft workspace to the Agent and records its session", async () => {
    const user = userEvent.setup()
    const attachSession = vi.fn().mockResolvedValue(undefined)
    const create = vi.fn().mockResolvedValue({
      extension: { id: "io.amiba.personal.calculator", name: "Calculator" },
      draft: { id: "draft-one", workspacePath: "/managed/worktrees/draft-one" },
      agentPrompt: "Build the calculator",
    })
    const startAgentTask = vi.fn().mockResolvedValue("session-one")
    render(
      <ManagedExtensionCreateDialog
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
        operationId: expect.any(String),
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

  it("cleans the initial draft when the Agent task cannot start", async () => {
    const user = userEvent.setup()
    const abortDraft = vi.fn().mockResolvedValue(null)
    const create = vi.fn().mockResolvedValue({
      extension: { id: "io.amiba.personal.calculator", name: "Calculator" },
      draft: { id: "draft-one", workspacePath: "/managed/worktrees/draft-one" },
      agentPrompt: "Build the calculator",
    })
    const startAgentTask = vi.fn().mockRejectedValue(new Error("Agent unavailable"))
    render(
      <ManagedExtensionCreateDialog
        open
        onOpenChange={() => {}}
        bridge={{ create, abortDraft } as never}
        startAgentTask={startAgentTask}
      />,
    )

    await user.type(screen.getByLabelText("Name"), "Calculator")
    await user.type(screen.getByLabelText("What should it do?"), "Calculate a mortgage")
    await user.click(screen.getByRole("button", { name: "Ask AI to create it" }))

    await waitFor(() => {
      expect(abortDraft).toHaveBeenCalledWith(
        "io.amiba.personal.calculator",
        "draft-one",
        "无法启动 AI 任务：Agent unavailable",
      )
    })
    expect(await screen.findByText("Agent unavailable")).toBeInTheDocument()
  })
})
