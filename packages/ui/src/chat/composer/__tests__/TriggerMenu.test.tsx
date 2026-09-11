import { act, waitFor, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TriggerMenu } from "../TriggerMenu"
import type { MenuItem } from "../providers/types"

const items: MenuItem[] = [
  { id: "a", label: "translate" },
  { id: "b", label: "summarize" },
]

describe("TriggerMenu", () => {
  it("fits above the composer and recomputes when the window changes", async () => {
    let anchorTop = 190
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-composer-card") ? anchorTop : 0, 600, 100)
    })
    try {
      const view = render(<div data-composer-card=""><TriggerMenu items={items} loading={false} error={null} onSelect={() => {}} onClose={() => {}} /></div>)
      const menu = view.container.querySelector<HTMLElement>("[data-composer-overlay]")!
      expect(menu.style.maxHeight).toBe("174px")
      anchorTop = 80
      act(() => { window.dispatchEvent(new Event("resize")) })
      await waitFor(() => expect(menu.style.maxHeight).toBe("64px"))
      anchorTop = 800
      act(() => { window.dispatchEvent(new Event("resize")) })
      await waitFor(() => expect(menu.style.maxHeight).toBe("384px"))
      view.unmount()
    } finally { rect.mockRestore() }
  })
  it("updates built-in group labels and hints with the interface language", async () => {
    const previous = document.documentElement.lang
    const groups = [
      { label: "reference", items: [items[0]] },
      { label: "Sessions", items: [items[1]] },
      { label: "My plugin", items: [items[0]] },
    ]
    const view = render(<TriggerMenu groups={groups} loading={false} error={null} onSelect={() => {}} onClose={() => {}} />)
    try {
      await act(async () => { document.documentElement.lang = "zh-CN" })
      await waitFor(() => expect(screen.getByRole("heading", { name: "对话" })).toBeVisible())
      expect(screen.getByRole("heading", { name: "引用" })).toBeVisible()
      expect(screen.getByRole("heading", { name: "My plugin" })).toBeVisible()
      await act(async () => { document.documentElement.lang = "en" })
      await waitFor(() => expect(screen.getByRole("heading", { name: "Sessions" })).toBeVisible())
      expect(screen.getByRole("heading", { name: "References" })).toBeVisible()
    } finally {
      view.unmount()
      await act(async () => { document.documentElement.lang = previous })
    }
  })
  it("renders items and selects on Enter", async () => {
    const onSelect = vi.fn()
    render(<TriggerMenu items={items} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />)
    expect(screen.getByText("translate")).toBeInTheDocument()
    expect(document.querySelector("kbd")).toBeNull()
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(items[0])
  })

  it("shows empty state", () => {
    render(<TriggerMenu items={[]} loading={false} error={null} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("No matches")).toBeInTheDocument()
  })

  it("shows error state", () => {
    render(<TriggerMenu items={[]} loading={false} error="boom" onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Couldn’t load results")).toBeInTheDocument()
  })

  it("shows a loading spinner", () => {
    render(<TriggerMenu items={[]} loading={true} error={null} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.getByText("Loading…")).toBeInTheDocument()
  })

  it("renders a category's empty-state hint when it has no items", () => {
    // A `requires_query` category with no query: shown in the sidebar, with its
    // hint in the content pane instead of vanishing.
    const groups = [{ label: "飞书文档", items: [], hint: "输入关键词搜索飞书文档" }]
    render(
      <TriggerMenu groups={groups} loading={false} error={null} onSelect={() => {}} onClose={() => {}} />,
    )
    expect(screen.getByText("飞书文档")).toBeInTheDocument()
    expect(screen.getByText("输入关键词搜索飞书文档")).toBeInTheDocument()
    expect(screen.queryByText(/no matches/i)).not.toBeInTheDocument()
  })

  it("arrow keys flow across category boundaries", async () => {
    const onSelect = vi.fn()
    const a1: MenuItem = { id: "a1", label: "A-one" }
    const b1: MenuItem = { id: "b1", label: "B-one" }
    const groups = [
      { label: "GroupA", items: [a1] }, // single item → ↓ crosses to GroupB
      { label: "GroupB", items: [b1] },
    ]
    render(
      <TriggerMenu groups={groups} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />,
    )
    // Start on GroupA's only item; ↓ at the boundary enters GroupB.
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(b1)
    // …and ↑ flows back into the previous category.
    onSelect.mockClear()
    await userEvent.keyboard("{ArrowUp}")
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(a1)
  })

  it("arrow navigation wraps around at the ends", async () => {
    const onSelect = vi.fn()
    const a1: MenuItem = { id: "a1", label: "A-one" }
    const b1: MenuItem = { id: "b1", label: "B-one" }
    const groups = [
      { label: "GroupA", items: [a1] },
      { label: "GroupB", items: [b1] },
    ]
    render(
      <TriggerMenu groups={groups} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />,
    )
    // From the first item, ↑ wraps to the last.
    await userEvent.keyboard("{ArrowUp}")
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(b1)
    // From the last item, ↓ wraps back to the first.
    onSelect.mockClear()
    await userEvent.keyboard("{ArrowDown}")
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(a1)
  })

  it("renders items from groups and selects on Enter", async () => {
    const onSelect = vi.fn()
    const item: MenuItem = { id: "x", label: "有赞小伙伴" }
    const groups = [{ label: "飞书群聊", items: [item] }]
    render(
      <TriggerMenu groups={groups} loading={false} error={null} onSelect={onSelect} onClose={() => {}} />,
    )
    expect(screen.getByText("有赞小伙伴")).toBeInTheDocument()
    await userEvent.keyboard("{Enter}")
    expect(onSelect).toHaveBeenCalledWith(item)
  })
})
