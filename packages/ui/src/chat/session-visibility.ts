/**
 * Session-list visibility policy: a session is dropped from every list
 * surface (sidebar history list, command palette, quick pickers) when
 * either:
 *
 * - it is bound to a preset a plugin asked to hide (the steward's own
 *   conversation is the first such case) — the session stays openable by
 *   id, it just leaves every list; or
 * - it is archived. Archiving is Amiba's only "get this out of my list"
 *   action, and DSH's own client hides archived rows from every grouping
 *   surface too, so there is currently no UI path back to an archived
 *   session. Revisit once DSH ships unarchive.
 *
 * `visibleChatSessions` applies both rules and is the single filter every
 * list-facing surface uses — the sidebar's history list and the command
 * palette alike. `filterSearchMatches` wraps it around a search callback for
 * the same reason: the palette swaps to its own `onSearchSessions` results as
 * soon as the user types, bypassing the filtered list it was handed.
 */

type VisibilityCandidate = { archived?: boolean; agent?: { profileId?: string } };

function normalizePresetId(id: string): string {
  return id.trim().toLocaleLowerCase();
}

function isHiddenPresetSession(
  session: VisibilityCandidate,
  hidden: ReadonlySet<string> | null,
): boolean {
  if (!hidden?.size) return false;
  const preset = session.agent?.profileId?.trim().toLocaleLowerCase();
  return !!(preset && hidden.has(preset));
}

/**
 * The filter every session list surface uses: drops archived sessions and
 * sessions bound to a hidden preset.
 */
export function visibleChatSessions<T extends VisibilityCandidate>(
  sessions: readonly T[],
  hiddenPresets?: ReadonlySet<string>,
): T[] {
  const hidden = hiddenPresets ? new Set([...hiddenPresets].map(normalizePresetId)) : null;
  return sessions.filter((session) => {
    if (session.archived) return false;
    return !isHiddenPresetSession(session, hidden);
  });
}

/**
 * A session bound to a preset a plugin asked to hide is runtime-owned: the
 * plugin (the steward is the first case) controls its identity, so nothing
 * in the chrome may rename it, even though — unlike `visibleChatSessions` —
 * this predicate does not care about `archived`, since the only caller today
 * checks the *active* session, which is never archived while open.
 *
 * Lives next to `visibleChatSessions` so both the list filter and the
 * top-bar rename gate agree on what "hidden preset" means (same
 * case-insensitive comparison), without either call site re-deriving it.
 */
export function isRuntimeOwnedSession<T extends VisibilityCandidate>(
  session: T | undefined,
  hiddenPresets?: ReadonlySet<string>,
): boolean {
  if (!session || !hiddenPresets?.size) return false;
  const hidden = new Set([...hiddenPresets].map(normalizePresetId));
  return isHiddenPresetSession(session, hidden);
}

/**
 * The command palette shows its own `onSearchSessions` results once the user
 * types, bypassing the filtered list it was handed — so a hidden or archived
 * session came straight back on the first keystroke. History search returns
 * the same index rows the list does (they carry `agent.profileId` and
 * `archived`), so `visibleChatSessions` covers both; this wraps the callback
 * rather than filtering inside the palette so the palette stays unaware of
 * visibility policy.
 *
 * Returns a STABLE function per (search, hiddenPresets) pair — callers must
 * memoize, since the palette re-runs its search effect whenever the callback's
 * identity changes.
 */
export function filterSearchMatches<T extends VisibilityCandidate>(
  search: ((query: string) => Promise<T[]>) | undefined,
  hiddenPresets?: ReadonlySet<string>,
): ((query: string) => Promise<T[]>) | undefined {
  if (!search) return undefined;
  return async (query: string) => visibleChatSessions(await search(query), hiddenPresets);
}
