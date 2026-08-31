import { render, screen } from "@testing-library/react"
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
    expect(
      screen.getByRole("region", { name: "sidepanel.permission.approvalNeeded" })
    ).toHaveClass("pb-2")
    expect(container.firstElementChild).toHaveClass("mx-4", "-mb-2.5", "z-0")
  })
})
