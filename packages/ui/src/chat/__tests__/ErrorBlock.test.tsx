import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@amiba/i18n", () => ({
  useT: () => ({ t: (key: string) => key }),
}))

import { ErrorBlock } from "../bubble/chips"
import { resolveChatErrorPresentation } from "../internal/error-presentation"

describe("chat error recovery", () => {
  it("turns an authentication failure into a targeted credentials action", async () => {
    const onOpenSettings = vi.fn()
    const user = userEvent.setup()

    render(
      <ErrorBlock
        error={{
          message: "HTTP 401: Invalid API Key",
          status: 401,
          source: "run",
        }}
        onOpenSettings={onOpenSettings}
      />,
    )

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-chat-error-kind",
      "credentials",
    )
    expect(
      screen.getByText("sidepanel.runError.credentials.title"),
    ).toBeInTheDocument()
    expect(screen.getByText("HTTP 401")).toBeInTheDocument()
    expect(screen.getByText("Invalid API Key")).toBeInTheDocument()

    await user.click(
      screen.getByRole("button", {
        name: "sidepanel.runError.credentials.action",
      }),
    )
    expect(onOpenSettings).toHaveBeenCalledWith("models")
  })

  it("recovers status and routing from legacy message-only errors", () => {
    expect(
      resolveChatErrorPresentation({
        message: "HTTP 503 — gateway unavailable",
      }),
    ).toMatchObject({
      kind: "connection",
      status: 503,
      detail: "gateway unavailable",
      settingsTarget: "connection",
    })
  })

  it("routes unclassified runtime failures to the error log", () => {
    expect(
      resolveChatErrorPresentation({
        message: "Unexpected tool response",
        source: "run",
      }),
    ).toMatchObject({
      kind: "runtime",
      settingsTarget: "logs?source=errors",
    })
  })

  it("keeps long diagnostics and the recovery action in one full-width content rail", () => {
    const detail =
      "This request requires more credits, or fewer max_tokens. Visit https://openrouter.ai/settings/credits to continue."

    render(
      <ErrorBlock
        error={{ message: `HTTP 402: ${detail}`, status: 402, source: "run" }}
        onOpenSettings={vi.fn()}
      />,
    )

    const content = screen
      .getByText(detail)
      .closest('[data-slot="chat-error-content"]')
    const action = screen.getByRole("button", {
      name: "sidepanel.runError.runtime.action",
    })

    expect(content).not.toBeNull()
    expect(content).toContainElement(action)
    expect(screen.getByText(detail)).toHaveClass("[overflow-wrap:anywhere]")

    const icon = screen
      .getByRole("alert")
      .querySelector('[data-slot="chat-error-icon"] svg')
    expect(icon).toHaveClass("h-3", "w-3")
    expect(icon?.parentElement).toHaveClass("text-[hsl(var(--warning))]")
    expect(icon?.parentElement).not.toHaveClass("text-destructive/75")
  })
})
