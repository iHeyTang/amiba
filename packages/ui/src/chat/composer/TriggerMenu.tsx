import { useT, type MessageKey } from "@amiba/i18n"
import { Loader2 } from "lucide-react"
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "../../primitives"
import { ComposerAddMenuContext } from "./ComposerAddMenuContext"
import type { MenuGroup, MenuItem } from "./providers/types"

export interface TriggerMenuProps {
  groups?: MenuGroup[]
  items?: MenuItem[]
  groupLabels?: string[]
  /** Present only for @ menus; allows the composer's own add actions. */
  mentionQuery?: string
  loading: boolean
  error: string | null
  onSelect: (item: MenuItem) => void
  onClose: () => void
  anchorClassName?: string
}

const GROUP_KEYS: Record<string, MessageKey> = {
  reference: "sidepanel.triggerMenu.group.reference",
  session: "sidepanel.triggerMenu.group.sessions",
  Sessions: "sidepanel.triggerMenu.group.sessions",
  skill: "sidepanel.triggerMenu.group.skills",
  Skills: "sidepanel.triggerMenu.group.skills",
  command: "sidepanel.triggerMenu.group.commands",
  Commands: "sidepanel.triggerMenu.group.commands",
}


const EMPTY_ITEMS: MenuItem[] = []

export function TriggerMenu({ groups, items = EMPTY_ITEMS, groupLabels, mentionQuery,
  loading, error, onSelect, onClose, anchorClassName }: TriggerMenuProps) {
  const { t } = useT()
  const availableActions = useContext(ComposerAddMenuContext)
  const groupLabel = (label: string) => Object.hasOwn(GROUP_KEYS, label) ? t(GROUP_KEYS[label]) : label
  const addActions = useMemo(() => mentionQuery === undefined ? [] : availableActions.filter(item =>
    !mentionQuery || item.label.toLocaleLowerCase().includes(mentionQuery.toLocaleLowerCase())), [availableActions, mentionQuery])
  const resolved = useMemo<MenuGroup[]>(() => {
    let result: MenuGroup[]
    if (groups) result = groups
    else if (groupLabels) {
      result = []
      items.forEach((item, i) => {
        const label = groupLabels[i] ?? ""
        const last = result[result.length - 1]
        if (last?.label === label) last.items.push(item)
        else result.push({ label, items: [item] })
      })
    } else result = items.length ? [{ label: "", items }] : []
    return addActions.length ? [{ label: t("sidepanel.triggerMenu.add"), items: addActions }, ...result] : result
  }, [groups, items, groupLabels, addActions, t])
  const positions = useMemo(() => resolved.flatMap((group, gi) => group.items.map((item, ii) => ({ gi, ii, item }))), [resolved])
  const [active, setActive] = useState(0)
  const current = positions[active] ?? positions[0]
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [availableHeight, setAvailableHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    // bottom-full is anchored to the nearest positioned ancestor. Measure
    // that anchor, not the animated popup (scale/translate distort its rect).
    const anchor = (root.offsetParent ?? root.parentElement) as HTMLElement | null
    if (!anchor) return
    const ancestors: HTMLElement[] = []
    for (let node: HTMLElement | null = anchor; node; node = node.parentElement) ancestors.push(node)
    const viewport = window.visualViewport
    let frame = 0
    const measure = () => {
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
      let top = viewportTop
      for (const node of ancestors) {
        if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowY)) {
          top = Math.max(top, node.getBoundingClientRect().top + node.clientTop)
        }
      }
      const gap = parseFloat(getComputedStyle(root).marginBottom) || 4
      const bottom = Math.min(anchor.getBoundingClientRect().top - gap, viewportBottom - 12)
      setAvailableHeight(Math.max(0, Math.min(384, bottom - top - 12)))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    const observer = new ResizeObserver(schedule)
    ancestors.forEach(node => observer.observe(node))
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, true)
    viewport?.addEventListener("resize", schedule)
    viewport?.addEventListener("scroll", schedule)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule, true)
      viewport?.removeEventListener("resize", schedule)
      viewport?.removeEventListener("scroll", schedule)
    }
  }, [])
  useEffect(() => { setActive(0) }, [resolved])
  useLayoutEffect(() => {
    // Scroll only the menu, never the window or the conversation behind it.
    const list = listRef.current
    const item = activeItemRef.current
    if (!list || !item) return
    const bounds = list.getBoundingClientRect()
    const row = item.getBoundingClientRect()
    if (row.top < bounds.top) list.scrollTop -= bounds.top - row.top
    else if (row.bottom > bounds.bottom) list.scrollTop += row.bottom - bounds.bottom
  }, [active, availableHeight])

  function select(item: MenuItem) {
    if (addActions.includes(item)) {
      onClose()
      item.action?.()
    } else onSelect(item)
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing) return
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onClose(); return
      }
      if (["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation()
        if (!positions.length) return
        if (event.key === "Enter") { if (current) select(current.item); return }
        if (event.key === "Tab") {
          const groupIds = [...new Set(positions.map(position => position.gi))]
          const groupIndex = groupIds.indexOf(current?.gi ?? 0)
          const target = groupIds[(groupIndex + (event.shiftKey ? -1 : 1) + groupIds.length) % groupIds.length]
          setActive(positions.findIndex(position => position.gi === target))
        } else setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + positions.length) % positions.length)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [positions, current, addActions, onClose, onSelect])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null
      const root = rootRef.current
      if (target && root && !root.contains(target) && !root.closest("[data-composer-card]")?.contains(target)) onClose()
    }
    document.addEventListener("pointerdown", outside)
    return () => document.removeEventListener("pointerdown", outside)
  }, [onClose])

  const status = error ? t("sidepanel.triggerMenu.loadFailed") : loading ? t("sidepanel.triggerMenu.loading") : t("sidepanel.triggerMenu.empty")
  return (
    <div ref={rootRef} data-composer-overlay="" data-ui-overlay="popover"
      style={{ maxHeight: availableHeight ?? 0, visibility: availableHeight === null ? "hidden" : undefined }}
      onMouseDown={event => event.preventDefault()}
      className={cn("absolute bottom-full left-0 right-0 z-50 mb-1 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-popover text-popover-foreground shadow-popover",
        "origin-bottom duration-150 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 motion-reduce:animate-none", anchorClassName)}>
      <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain p-1.5" data-trigger-group-list="">
        {resolved.map((group, gi) => (
          <section key={`${gi}:${group.label}`} className="mb-1 last:mb-0">
            {group.label && <h3 className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground/75">{groupLabel(group.label)}</h3>}
            {group.items.map((item, ii) => {
              const selected = current?.gi === gi && current?.ii === ii
              return <button key={item.id} ref={selected ? activeItemRef : null} type="button"
                onMouseEnter={() => setActive(positions.findIndex(position => position.gi === gi && position.ii === ii))}
                onClick={() => select(item)}
                className={cn("flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left",
                  selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50")}>
                {item.icon && <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>}
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="max-w-full shrink-0 truncate text-sm">{item.label}</span>
                  {item.description && <span className="min-w-0 truncate text-xs text-muted-foreground/75">{item.description}</span>}
                </span>
              </button>
            })}
            {!group.items.length && group.hint && <p className="px-2.5 py-2 text-xs text-muted-foreground">{group.hint}</p>}
          </section>
        ))}
        {(!resolved.length || loading || error) && <div className={cn("flex items-center justify-center gap-2 px-3 py-6 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {loading && !error && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{status}
        </div>}
      </div>

    </div>
  )
}
