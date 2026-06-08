import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TriggerMenu } from "../TriggerMenu"
import type { MenuItem } from "../providers/types"

const items: MenuItem[] = [
  { id: "a", label: "translate" },
  { id: "b", label: "summarize" },
]

describe("TriggerMenu", () => {
  it("renders items and selects on Enter", async () => {
    const onSelect = vi.fn()
    render(<TriggerMenu items={items} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />)
    expect(screen.getByText("translate")).toBeInTheDocument()
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it("shows empty state", () => {
    render(<TriggerMenu items={[]} loading={false} error={null} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/no matches/i)).toBeInTheDocument()
  })

  it("shows error state", () => {
    render(<TriggerMenu items={[]} loading={false} error="boom" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/failed/i)).toBeInTheDocument()
  })
})
