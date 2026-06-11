import { useEffect, useMemo, useState } from "react"
import { cn } from "../../primitives"
import type { MenuItem } from "./providers/types"

export interface TriggerMenuProps {
  items: MenuItem[]
  /**
   * Parallel to `items`: the group label for each item (e.g. "Skills",
   * "Commands", or an integration name). When provided AND there is more
   * than one group, the menu switches to a two-pane layout — a group
   * sidebar on the left, the current group's items on the right. Omit
   * (e.g. in tests) or pass a single group to render a flat list.
   * Keyboard nav: ↑/↓ move within the current group, Tab/Shift+Tab switch
   * groups (←/→ are left alone so they keep moving the text caret), Enter
   * selects, Esc closes.
   */
  groupLabels?: string[]
  loading: boolean
  error: string | null
  onSelect: (item: MenuItem) => void
  onClose: () => void
  anchorClassName?: string
}

interface Group {
  label: string
  items: MenuItem[]
}

export function TriggerMenu({
  items,
  groupLabels,
  loading,
  error,
  onSelect,
  onClose,
  anchorClassName,
}: TriggerMenuProps) {
  // Items arrive already clustered by group (the plugin builds them that
  // way), so a single pass turns them into contiguous sections.
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    items.forEach((item, i) => {
      const label = groupLabels?.[i] ?? ""
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(item)
      else out.push({ label, items: [item] })
    })
    return out
  }, [items, groupLabels])

  // Two-pane (group sidebar + current group's list) only when there are
  // real groups to split by; otherwise a flat list. The flat path is also
  // what the tests exercise (they pass no groupLabels).
  const twoPane = groupLabels != null && groups.length > 1

  const [activeGroup, setActiveGroup] = useState(0)
  const [activeItem, setActiveItem] = useState(0)
  // Reset the selection whenever the result set changes (new query).
  useEffect(() => {
    setActiveGroup(0)
    setActiveItem(0)
  }, [items, groupLabels])

  const currentGroup = groups[Math.min(activeGroup, groups.length - 1)]

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const len = currentGroup?.items.length ?? 0
        setActiveItem((i) => Math.min(i + 1, len - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveItem((i) => Math.max(i - 1, 0))
      } else if (twoPane && e.key === "Tab") {
        // Switch group. We deliberately do NOT use ←/→ — those must keep
        // moving the text caret in the composer while the menu is open.
        e.preventDefault()
        const dir = e.shiftKey ? -1 : 1
        setActiveGroup((g) => (g + dir + groups.length) % groups.length)
        setActiveItem(0)
      } else if (e.key === "Enter") {
        const item = currentGroup?.items[activeItem]
        if (item) {
          e.preventDefault()
          onSelect(item)
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [twoPane, groups, currentGroup, activeItem, onSelect, onClose])

  const renderItem = (item: MenuItem, ii: number) => (
    <button
      key={item.id}
      type="button"
      onMouseEnter={() => setActiveItem(ii)}
      onClick={() => onSelect(item)}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
        ii === activeItem
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50",
      )}
    >
      {item.icon}
      <span className="truncate">{item.label}</span>
      {item.description && (
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {item.description}
        </span>
      )}
    </button>
  )

  return (
    <div
      data-composer-overlay=""
      className={cn(
        "absolute left-0 right-0 bottom-full z-50 mb-1 rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        anchorClassName,
      )}
    >
      {loading && items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
      )}
      {error && (
        <div className="px-2 py-1.5 text-xs text-destructive">Failed to load</div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
      )}

      {items.length > 0 &&
        (twoPane ? (
          <div className="flex max-h-64">
            {/* Left: group sidebar. Hover or click switches the group;
                mousedown is prevented so the click doesn't steal focus from
                the editor and close the menu. */}
            <div className="w-32 shrink-0 overflow-y-auto border-r border-border p-1">
              {groups.map((g, gi) => (
                <button
                  key={g.label || gi}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => {
                    setActiveGroup(gi)
                    setActiveItem(0)
                  }}
                  onClick={() => {
                    setActiveGroup(gi)
                    setActiveItem(0)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between gap-1 rounded px-2 py-1.5 text-left text-xs",
                    gi === activeGroup
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  <span className="truncate">{g.label}</span>
                  <span className="shrink-0 tabular-nums opacity-60">
                    {g.items.length}
                  </span>
                </button>
              ))}
            </div>
            {/* Right: the active group's items. */}
            <div className="min-w-0 flex-1 overflow-y-auto p-1">
              {currentGroup?.items.map(renderItem)}
            </div>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto p-1">
            {items.map(renderItem)}
          </div>
        ))}
    </div>
  )
}
