import { useEffect, useRef } from "react"

/**
 * Re-run a fetch whenever the window regains focus or the document
 * becomes visible again.
 *
 * The freshness contract for the built-in data pages (Skills / Tokens /
 * Tools) is app-guaranteed: load on mount, refetch on focus, plus
 * per-page polling or push where the source allows. This hook is the
 * "refetch on focus" leg — it covers the "agent changed something in a
 * session, user tabs back to look" path without a manual refresh button.
 *
 * The callback is kept in a ref so callers can pass a fresh closure on
 * every render without resubscribing the listeners.
 */
export function useRefetchOnFocus(refetch: () => void): void {
  const ref = useRef(refetch)
  ref.current = refetch

  useEffect(() => {
    const onFocus = () => ref.current()
    const onVisibility = () => {
      if (document.visibilityState === "visible") ref.current()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [])
}
