/**
 * Generic, plugin-facing extension points for the session history list:
 * declarative badges and tri-state filters. This module is core UI — it
 * carries no plugin semantics (no "steward", no "adopted"), only the shapes
 * a plugin's contribution takes and the pure functions the list renders
 * through. `packages/ui/src/chat/SessionsListView.tsx` is the one renderer;
 * `plugins/dsh-plugin-ui-shell` is the one place that turns DSH slot
 * registrations (`amiba.sessions.item.badge` / `amiba.sessions.list.filter`)
 * into the arrays these functions take.
 */

/**
 * Core-owned, read-only subset of `SessionMeta` a badge/filter resolver may
 * read. Deliberately narrower than `SessionMeta` — a plugin's `resolve`/
 * `test` face should not depend on presentation-only fields (pinned,
 * archived, …) that have nothing to do with what a badge or filter means.
 */
export interface SessionBadgeTarget {
  id: string;
  title: string;
  agent?: { profileId?: string };
  source?: string;
  parentSessionId?: string;
}

/**
 * One `amiba.sessions.item.badge` registration, projected by the shell into
 * a plain object the list can render without knowing about DSH slots.
 * `resolve(session)`:
 *   - `true`   → render `label` as the chip text.
 *   - a string → render that string as the chip text.
 *   - `false`/`null` → no chip for this session.
 */
export interface SessionBadgeSource {
  id: string;
  order: number;
  label: string;
  resolve: (session: SessionBadgeTarget) => string | boolean | null;
}

/**
 * One `amiba.sessions.list.filter` registration, projected the same way.
 * `test(session)` reports whether the session matches this filter's
 * predicate; the list's tri-state chip decides whether matches, non-matches,
 * or everything is kept.
 */
export interface SessionListFilter {
  id: string;
  label: string;
  test: (session: SessionBadgeTarget) => boolean;
}

/** A filter chip's selection: unset, "keep matches", or "keep non-matches". */
export type SessionFilterState = boolean | null;

/**
 * Applies every filter whose state is non-null, AND-combined. A filter left
 * at `null` (including one with no entry in `states` at all) does not
 * constrain the result. With no active filters, `sessions` is returned
 * unchanged (same array reference not guaranteed, same elements are).
 */
export function applyTriStateFilters<T extends SessionBadgeTarget>(
  sessions: readonly T[],
  filters: readonly SessionListFilter[],
  states: Readonly<Record<string, SessionFilterState | undefined>>,
): T[] {
  const active = filters.filter((filter) => {
    const state = states[filter.id];
    return state === true || state === false;
  });
  if (active.length === 0) return sessions.slice();
  return sessions.filter((session) =>
    active.every((filter) => filter.test(session) === states[filter.id]),
  );
}

/**
 * Resolves the chip texts for one session against an ordered list of badge
 * sources. Callers pass `badges` pre-sorted by `order` — this function does
 * not re-sort, so the returned order is exactly the input order.
 */
export function resolveBadgeTexts(
  session: SessionBadgeTarget,
  badges: readonly SessionBadgeSource[],
): string[] {
  const texts: string[] = [];
  for (const badge of badges) {
    const result = badge.resolve(session);
    if (result === true) texts.push(badge.label);
    else if (typeof result === "string" && result.length > 0) texts.push(result);
  }
  return texts;
}
