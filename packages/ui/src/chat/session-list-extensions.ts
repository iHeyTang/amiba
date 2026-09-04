/**
 * Generic, plugin-facing extension points for the session history list:
 * declarative badges, a "group" that pulls claimed sessions into their own
 * section, and row "more" (⋯) menu items. This module is core UI — it
 * carries no plugin semantics (no "steward", no "adopted"), only the shapes
 * a plugin's contribution takes and the pure functions the list renders
 * through. `packages/ui/src/chat/SessionsListView.tsx` is the one renderer;
 * `plugins/dsh-plugin-ui-shell` is the one place that turns DSH slot
 * registrations (`amiba.sessions.item.badge` / `amiba.sessions.list.group` /
 * `amiba.sessions.item.menu`) into the arrays these functions take.
 */

/**
 * Core-owned, read-only subset of `SessionMeta` a badge/group/menu resolver
 * may read. Deliberately narrower than `SessionMeta` — a plugin's `resolve`/
 * `claim`/`visible` face should not depend on presentation-only fields
 * (archived, …) that have nothing to do with what a badge, group, or menu
 * item means.
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
 * badge source. Appended to a session row's "more" (⋯) menu after the
 * built-in actions (rename/branch/archive/export/delete).
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
 * One `amiba.sessions.list.group` registration, projected the same way as a
 * badge/menu source. `claim(session)` reports whether this group takes
 * ownership of a session — a claimed session is pulled out of the list's
 * normal channel/date buckets and rendered under this group's own section
 * instead (see `partitionSessionGroups`).
 */
export interface SessionListGroup {
  id: string;
  label: string;
  claim: (session: SessionBadgeTarget) => boolean;
}

/** One plugin group's section, in `groups` order, holding its claimed rows. */
export interface SessionListGroupBucket<T> {
  group: SessionListGroup;
  items: T[];
}

export interface SessionListGroupPartition<T> {
  /** One entry per NON-EMPTY group, in the input `groups` order. */
  groups: SessionListGroupBucket<T>[];
  /** Every session no group claimed, in the input `sessions` order. */
  rest: T[];
}

/**
 * Splits `sessions` between the plugin groups that claim them and the rest.
 * Each session is tested against `groups` in order; the FIRST group whose
 * `claim` returns true takes it — a session appears in exactly one place,
 * either one group's `items` or `rest`, never both and never twice. A group
 * nothing claims is omitted from the result entirely (`groups` only ever
 * holds non-empty buckets). Within a group's `items`, rows are sorted
 * newest-first by `updatedAt`; `rest` keeps the input order (the list's
 * existing channel/date bucketing re-sorts it downstream).
 */
export function partitionSessionGroups<
  T extends SessionBadgeTarget & { updatedAt?: number },
>(
  sessions: readonly T[],
  groups: readonly SessionListGroup[],
): SessionListGroupPartition<T> {
  const buckets = new Map<string, T[]>(groups.map((group) => [group.id, []]));
  const rest: T[] = [];
  for (const session of sessions) {
    const owner = groups.find((group) => group.claim(session));
    if (owner) buckets.get(owner.id)!.push(session);
    else rest.push(session);
  }
  const byUpdatedAtDesc = (a: T, b: T) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  const result: SessionListGroupBucket<T>[] = [];
  for (const group of groups) {
    const items = buckets.get(group.id) ?? [];
    if (items.length === 0) continue;
    result.push({ group, items: items.slice().sort(byUpdatedAtDesc) });
  }
  return { groups: result, rest };
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
