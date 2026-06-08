import { useEffect, useState } from "react"
import { cn } from "../../primitives"
import type { MenuItem } from "./providers/types"

export interface TriggerMenuProps {
  items: MenuItem[]
  loading: boolean
  error: string | null
  onSelect: (item: MenuItem) => void
  onClose: () => void
  anchorClassName?: string
}

export function TriggerMenu({ items, loading, error, onSelect, onClose, anchorClassName }: TriggerMenuProps) {
  const [active, setActive] = useState(0)
  useEffect(() => { setActive(0) }, [items])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)) }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
      else if (e.key === "Enter") { if (items[active]) { e.preventDefault(); onSelect(items[active]) } }
      else if (e.key === "Escape") { e.preventDefault(); onClose() }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [items, active, onSelect, onClose])

  return (
    <div className={cn(
      "absolute left-0 right-0 bottom-full z-50 mb-1 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
      anchorClassName,
    )}>
      {loading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="px-2 py-1.5 text-xs text-destructive">Failed to load</div>}
      {!loading && !error && items.length === 0 && (
        <div className="px-2 py-1.5 text-xs text-muted-foreground">No matches</div>
      )}
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          onMouseEnter={() => setActive(i)}
          onClick={() => onSelect(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
            i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
        >
          {item.icon}
          <span className="truncate">{item.label}</span>
          {item.description && <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>}
        </button>
      ))}
    </div>
  )
}
