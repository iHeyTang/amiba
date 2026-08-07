import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../primitives"
import type { MenuGroup, MenuItem } from "./providers/types"

export interface TriggerMenuProps {
  /**
   * Pre-clustered categories (the plugin builds these). Preferred over
   * `items`/`groupLabels`. A group with no `items` but a `hint` renders its
   * hint as the category's empty state (e.g. "type to search Feishu docs").
   */
  groups?: MenuGroup[]
  items?: MenuItem[]
  /**
   * Parallel to `items`: the group label for each item. When provided (and no
   * `groups`), the menu clusters items into a two-pane layout. Omit (e.g. in
   * tests) to render a flat list.
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
  hint?: string
}

const KBD =
  "rounded border border-border bg-muted/60 px-1 text-[9px] leading-[1.5] text-muted-foreground"

export function TriggerMenu({
  groups,
  items = [],
  groupLabels,
  loading,
  error,
  onSelect,
  onClose,
  anchorClassName,
}: TriggerMenuProps) {
  // Resolve the categories to render. Three callers:
  //  - `groups` given → use directly (the composer plugin).
  //  - `groupLabels` given → cluster `items` by label into contiguous groups.
  //  - neither → a single flat group of `items` (tests).
  const resolved = useMemo<Group[]>(() => {
    if (groups) return groups
    if (groupLabels) {
      const out: Group[] = []
      items.forEach((item, i) => {
        const label = groupLabels[i] ?? ""
        const last = out[out.length - 1]
        if (last && last.label === label) last.items.push(item)
        else out.push({ label, items: [item] })
      })
      return out
    }
    return items.length ? [{ label: "", items }] : []
  }, [groups, items, groupLabels])

  // Two-pane (sidebar + content) whenever categories are explicit (`groups` or
  // `groupLabels`); the flat path is only for callers passing bare `items`.
  const twoPane = (groups != null || groupLabels != null) && resolved.length >= 1
  const totalItems = useMemo(() => resolved.reduce((n, g) => n + g.items.length, 0), [resolved])
  // Flat (groupIndex, itemIndex) sequence over the categories that have items,
  // so ↑/↓ flow into the adjacent category at a boundary (Tab still switches
  // whole categories, including hint-only ones).
  const positions = useMemo(() => {
    const out: { gi: number; ii: number }[] = []
    resolved.forEach((g, gi) => g.items.forEach((_, ii) => out.push({ gi, ii })))
    return out
  }, [resolved])

  const [activeGroup, setActiveGroup] = useState(0)
  const [activeItem, setActiveItem] = useState(0)
  // Reset the selection whenever the result set changes (new query).
  useEffect(() => {
    setActiveGroup(0)
    setActiveItem(0)
  }, [resolved])

  const currentGroup = resolved[Math.min(activeGroup, resolved.length - 1)]

  // Keep the active item / group scrolled into view during keyboard nav.
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const activeGroupRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    // `?.scrollIntoView?.` — optional on the method too, so it's a no-op in
    // non-browser environments (jsdom/SSR) that don't implement it.
    activeItemRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [activeItem, activeGroup])
  useEffect(() => {
    activeGroupRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [activeGroup])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // We listen on `window` in the CAPTURE phase, so stopping propagation
      // here prevents the event from ever reaching the Lexical editor below
      // — that's what keeps Enter from inserting a newline / submitting, and
      // ↑/↓/Tab from doing anything in the composer while the menu is open.
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        e.stopPropagation()
        if (positions.length === 0) return
        const dir = e.key === "ArrowDown" ? 1 : -1
        let idx = positions.findIndex((p) => p.gi === activeGroup && p.ii === activeItem)
        if (idx === -1) {
          // Active category has no items (a hint category reached via Tab) —
          // step into the nearest item category in the direction of travel.
          let seed = -1
          for (let k = 0; k < positions.length; k++) {
            if (dir > 0) {
              if (positions[k].gi >= activeGroup) { seed = k; break }
            } else if (positions[k].gi <= activeGroup) {
              seed = k
            }
          }
          idx = seed === -1 ? (dir > 0 ? 0 : positions.length - 1) : seed
        } else {
          // Wrap around: ↓ past the last item loops to the first, and ↑ before
          // the first loops to the last (consistent with Tab's group cycling).
          idx = (idx + dir + positions.length) % positions.length
        }
        const pos = positions[idx]
        setActiveGroup(pos.gi)
        setActiveItem(pos.ii)
      } else if (twoPane && resolved.length > 1 && e.key === "Tab") {
        // Switch group. We deliberately do NOT use ←/→ — those must keep
        // moving the text caret in the composer while the menu is open.
        e.preventDefault()
        e.stopPropagation()
        const dir = e.shiftKey ? -1 : 1
        setActiveGroup((g) => (g + dir + resolved.length) % resolved.length)
        setActiveItem(0)
      } else if (e.key === "Enter") {
        const item = currentGroup?.items[activeItem]
        if (item) {
          e.preventDefault()
          e.stopPropagation()
          onSelect(item)
        }
      } else if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [twoPane, resolved, positions, currentGroup, activeGroup, activeItem, onSelect, onClose])

  // Two-line item: title on top, description/intro below (both truncate).
  // The icon sits to the left, vertically centred against the block.
  const renderItem = (item: MenuItem, ii: number) => (
    <button
      key={item.id}
      ref={ii === activeItem ? activeItemRef : null}
      type="button"
      onMouseEnter={() => setActiveItem(ii)}
      onClick={() => onSelect(item)}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
        ii === activeItem
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent/50",
      )}
    >
      {item.icon && <span className="shrink-0">{item.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{item.label}</span>
        {item.description && (
          <span
            className={cn(
              "block truncate text-xs",
              ii === activeItem
                ? "text-accent-foreground/75"
                : "text-muted-foreground",
            )}
          >
            {item.description}
          </span>
        )}
      </span>
    </button>
  )

  return (
    <div
      data-composer-overlay=""
      data-ui-overlay="popover"
      className={cn(
        // The editor supplies a virtual text trigger and must retain focus, so
        // this cannot use Radix Popover's trigger/focus lifecycle. It still
        // follows the shared Popover frame and enter motion contract.
        "absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-xl border border-border/60 bg-popover text-popover-foreground shadow-popover",
        "origin-bottom duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none",
        anchorClassName,
      )}
    >
      {resolved.length === 0 ? (
        // Same fixed height as the populated menu, so the loading / empty /
        // error states don't resize the popup.
        <div className="flex h-64 items-center justify-center px-4 text-center text-xs">
          {error ? (
            <span className="text-destructive">加载失败</span>
          ) : loading ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载中…
            </span>
          ) : (
            <span className="text-muted-foreground">无匹配结果</span>
          )}
        </div>
      ) : twoPane ? (
          // Fixed height so the popup doesn't jump as the active category's
          // content changes (50 items vs. a one-line hint) — it scrolls instead.
          <div className="flex h-64">
            {/* Left: group sidebar. Hover or click switches the group;
                mousedown is prevented so the click doesn't steal focus from
                the editor and close the menu. */}
            <div className="w-32 shrink-0 overflow-y-auto border-r border-border p-1">
              {resolved.map((g, gi) => (
                <button
                  key={g.label || gi}
                  ref={gi === activeGroup ? activeGroupRef : null}
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
                  {g.items.length > 0 && (
                    <span className="shrink-0 tabular-nums opacity-60">
                      {g.items.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {/* Right: the active group's items, or its empty-state hint. */}
            <div className="min-w-0 flex-1 overflow-y-auto p-1">
              {currentGroup && currentGroup.items.length > 0
                ? currentGroup.items.map(renderItem)
                : currentGroup?.hint && (
                    <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                      {currentGroup.hint}
                    </div>
                  )}
            </div>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto p-1">
            {currentGroup?.items.map(renderItem)}
          </div>
        )}

      {/* Footer: keyboard hints. */}
      {totalItems > 0 && (
        <div className="flex items-center gap-3 border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className={KBD}>↑↓</kbd>选择
          </span>
          {resolved.length > 1 && (
            <span className="flex items-center gap-1">
              <kbd className={KBD}>Tab</kbd>切换分组
            </span>
          )}
          <span className="flex items-center gap-1">
            <kbd className={KBD}>↵</kbd>引用
          </span>
          <span className="ml-auto flex items-center gap-1">
            <kbd className={KBD}>esc</kbd>关闭
          </span>
        </div>
      )}
    </div>
  )
}
