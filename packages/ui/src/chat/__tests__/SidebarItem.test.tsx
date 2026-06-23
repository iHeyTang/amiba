import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SidebarItem } from "../SidebarItem"

describe("SidebarItem", () => {
  it("renders its label, marks active, and fires onClick", async () => {
    const onClick = vi.fn()
    render(
      <SidebarItem id="skills" icon={<span>icon</span>} label="技能" active onClick={onClick} />,
    )
    const btn = screen.getByTestId("sidebar-item-skills")
    expect(btn).toHaveTextContent("技能")
    expect(btn).toHaveAttribute("aria-current", "page")
    await userEvent.click(btn)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("renders trailing content and omits aria-current when inactive", () => {
    render(
      <SidebarItem
        id="chats"
        icon={<span>i</span>}
        label="对话"
        onClick={() => {}}
        trailing={<span data-testid="trail">9</span>}
      />,
    )
    expect(screen.getByTestId("sidebar-item-chats")).not.toHaveAttribute("aria-current")
    expect(screen.getByTestId("trail")).toBeInTheDocument()
  })
})
