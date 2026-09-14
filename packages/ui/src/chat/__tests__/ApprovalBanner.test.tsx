import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key })
}))

import { ApprovalBanner } from "../bubble/approval"

describe("ApprovalBanner", () => {
  it("keeps every allow scope at the same visual priority", () => {
    const { container } = render(
      <ApprovalBanner
        approvals={[
          {
            approvalId: "approval-1",
            requestId: "run-1",
            tool: "terminal",
            command: "python3 -c 'print(1)'",
            description: "command parser limit or malformed executable payload",
            raw: { timestamp: Date.now() / 1000 }
          }
        ]}
        inFlight={{}}
        error={null}
        onRespond={vi.fn()}
        onDismissError={vi.fn()}
      />
    )

    const allowButtons = [
      screen.getByRole("button", { name: "sidepanel.permission.allowOnce" }),
      screen.getByRole("button", { name: "sidepanel.permission.allowSession" }),
      screen.getByRole("button", { name: "sidepanel.permission.allowAlways" })
    ]

    expect(new Set(allowButtons.map((button) => button.className)).size).toBe(1)
    expect(allowButtons[0]).toHaveClass("bg-transparent")
    expect(allowButtons[0]).not.toHaveClass("bg-foreground")
    expect(screen.getByRole("button", { name: "sidepanel.permission.deny" })).toHaveClass(
      "bg-transparent",
      "text-destructive/85"
    )
    expect(
      screen.getByRole("region", { name: "sidepanel.permission.approvalNeeded" })
    ).toBeInTheDocument()
    expect(screen.queryByText("sidepanel.permission.approvalNeeded")).not.toBeInTheDocument()
    const explanation = screen.getByText(
      "sidepanel.permission.reason.unverifiedEmbeddedScript"
    )
    expect(explanation).toHaveClass("text-[11px]", "text-foreground/70")
    expect(
      screen.getByTitle("command parser limit or malformed executable payload")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("command parser limit or malformed executable payload")
    ).not.toBeInTheDocument()
    expect(container.querySelector("[data-approval-countdown]")).toHaveClass(
      "mt-px",
      "h-4",
      "w-4"
    )
    expect(container.querySelector("[data-approval-actions]")).toHaveClass("mt-2")
    expect(container.querySelector("[data-approval-code]")).toHaveTextContent(
      "python3 -c 'print(1)'"
    )
    expect(container.querySelector("[data-approval-code]")).toHaveAttribute(
      "data-languages",
      "shell python"
    )
    expect(container.querySelector(".approval-code .token.number")).toHaveTextContent("1")
    // Bottom clearance now belongs to the ComposerDockSheet container
    // (pb-5), not to each section.
    expect(
      screen.getByRole("region", { name: "sidepanel.permission.approvalNeeded" })
    ).not.toHaveClass("pb-2")
    expect(container.firstElementChild).toHaveClass(
      "mx-4",
      "-mb-2.5",
      "z-0",
      "pb-5"
    )
  })
})

describe("approval detail extensions", () => {
  const request = { approvalId: "a", requestId: "rpc", sessionId: "s", toolCallId: "call-real", command: "pwd" }
  const props = { approvals: [request], inFlight: {}, error: null, onRespond: vi.fn(), onDismissError: vi.fn() }

  it("uses the correlated call while retaining the original decision request", () => {
    const renderDetail = vi.fn((callId: string) => <div>Detail {callId}</div>)
    const view = render(<ApprovalBanner {...props} renderDetail={renderDetail} />)
    expect(screen.getByText("Detail call-real")).toBeInTheDocument()
    expect(view.container.querySelector("[data-approval-code]")).toHaveTextContent("pwd")
    expect(view.container.querySelectorAll("[data-approval-actions] button")).toHaveLength(4)
    fireEvent.click(screen.getByRole("button", { name: "sidepanel.permission.allowOnce" }))
    expect(props.onRespond).toHaveBeenLastCalledWith(request, "once")
    view.rerender(<ApprovalBanner {...props} approvals={[{ ...request, toolCallId: "next-call" }]} renderDetail={renderDetail} />)
    expect(screen.queryByText("Detail call-real")).not.toBeInTheDocument()
    expect(screen.getByText("Detail next-call")).toBeInTheDocument()
  })

  it("does not invent a call identity or leave an empty detail container", () => {
    const renderDetail = vi.fn(() => <div>Uncorrelated detail</div>)
    const view = render(<ApprovalBanner {...props} approvals={[{ ...request, toolCallId: undefined }]} renderDetail={renderDetail} />)
    expect(renderDetail).not.toHaveBeenCalled()
    expect(view.container.querySelector(".approval-code")?.nextElementSibling).toHaveAttribute("data-approval-actions")
  })

  it("isolates failed plugin details and recovers for the next approval", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const renderDetail = (callId: string) => {
        if (callId === "call-real") throw new Error("plugin failed")
        return <div>Recovered detail</div>
      }
      const view = render(<ApprovalBanner {...props} renderDetail={renderDetail} />)
      fireEvent.click(screen.getByRole("button", { name: "sidepanel.permission.deny" }))
      expect(props.onRespond).toHaveBeenLastCalledWith(request, "deny")
      view.rerender(<ApprovalBanner {...props} approvals={[{ ...request, approvalId: "b", toolCallId: "next" }]} renderDetail={renderDetail} />)
      expect(screen.getByText("Recovered detail")).toBeInTheDocument()
    } finally { errors.mockRestore() }
  })
})
