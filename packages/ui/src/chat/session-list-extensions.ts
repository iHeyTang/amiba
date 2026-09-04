/**
 * Generic, plugin-facing extension points for the session history list:
 * declarative badges and row "more" (⋯) menu items. This module is core
 * UI — it carries no plugin semantics (no "steward", no "adopted"), only
 * the shapes a plugin's contribution takes and the pure functions the list
 * renders through. `packages/ui/src/chat/SessionsListView.tsx` is the one
 * renderer; `plugins/dsh-plugin-ui-shell` is the one place that turns DSH
 * slot registrations (`amiba.sessions.item.badge` / `amiba.sessions.item.menu`)
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
 * One `amiba.sessions.item.menu` registration, projected the same way as a
 * badge/filter source. Appended to a session row's "more" (⋯) menu after the
 * built-in actions (rename/pin/branch/archive/export/delete).
 *   - `visible(session)` — omitted means always visible; `false` hides this
 *     item for that session (e.g. already handled, not applicable).
 *   - `run(session)` — invoked on click. The list catches a throw/rejection
 *     and logs it; it never bubbles into the row.
 */
export interface SessionListMenuItem {
  id: string;
  label: string;
  visible?: (session: SessionBadgeTarget) => boolean;
  run: (session: SessionBadgeTarget) => void | Promise<void>;
}

/**
 * Filters `items` down to the ones visible for `session` — an item with no
 * `visible` is always kept; one with `visible` is kept only when it returns
 * `true`. Order is preserved from the input.
 */
export function resolveMenuItems<T extends SessionBadgeTarget>(
  session: T,
  items: readonly SessionListMenuItem[],
): SessionListMenuItem[] {
  return items.filter((item) => item.visible?.(session) ?? true);
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
