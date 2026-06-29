import { useEffect, useState } from "react"

/**
 * Owns the command-palette open state and the global ⌘K / Ctrl+K toggle.
 * ⌘K is free in the main window (only the separate Quick-Ask popup uses it).
 */
export function useCommandPalette(): {
  open: boolean
  setOpen: (open: boolean) => void
} {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  return { open, setOpen }
}
