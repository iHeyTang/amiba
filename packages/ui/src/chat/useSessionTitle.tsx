/**
 * "Inner-closed, outer-open" title override for the chat surface's top
 * bar. The bar reads its display string via `useSessionTitle()`; any
 * descendant component can push a hot update by calling
 * `useSetSessionTitle(value)` — last write wins, declarative on mount /
 * unmount, no manual subscription wiring.
 *
 * The mechanism is intentionally additive: when no contributor is
 * actively overriding, the read hook returns `null` and the bar falls
 * back to its built-in derivation (active session title → product
 * wordmark). Contributors only need to know what they want to show —
 * not how the bar normally resolves its label.
 *
 * Two consumer hooks:
 *
 *   - `useSessionTitle()`   — read the current override (top bar uses this)
 *   - `useSetSessionTitle()` — push an override; cleared on unmount
 *
 * Wrap the relevant subtree once with `SessionTitleProvider`. The
 * provider is mounted inside `FullScreenChatView` by default.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

interface SessionTitleStore {
  title: string | null;
  setTitle: (next: string | null) => void;
}

const Context = createContext<SessionTitleStore | null>(null);

export function SessionTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  return (
    <Context.Provider value={{ title, setTitle }}>{children}</Context.Provider>
  );
}

/**
 * Read the current title override. Returns `null` when no contributor
 * is overriding — callers should fall back to a sensible default.
 */
export function useSessionTitle(): string | null {
  return useContext(Context)?.title ?? null;
}

/**
 * Declaratively register a title override for the lifetime of the
 * calling component. Pass a string to set; pass `null` to opt out
 * (useful when the contributor is conditionally applicable, e.g. only
 * when its data source is selected).
 *
 * - Setting on every value change keeps the bar "hot" — there is no
 *   debounce or imperative setter; the bar reflects whatever you most
 *   recently rendered.
 * - On unmount the override is cleared, so a contributor leaving the
 *   tree never leaves stale text behind.
 *
 * Race semantics: last write wins. If two contributors both push
 * non-null titles, render order decides — return `null` from
 * contributors that don't apply rather than racing.
 */
export function useSetSessionTitle(value: string | null): void {
  const ctx = useContext(Context);
  useEffect(() => {
    if (!ctx) return;
    ctx.setTitle(value);
  }, [ctx, value]);

  // Separate cleanup-only effect so transient value transitions don't
  // briefly null-out the title between unmounting one override and the
  // setter running for the new one.
  useEffect(() => {
    if (!ctx) return;
    return () => {
      ctx.setTitle(null);
    };
  }, [ctx]);
}
