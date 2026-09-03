/**
 * The one place the chat history list decides what to show. Archived rows
 * are hidden as before; a plugin may additionally hide every session bound
 * to one of its agent presets (the steward's own conversation is the first
 * such case) — those sessions stay openable by id, they just leave the list.
 */
export function visibleChatSessions<T extends { archived?: boolean; agent?: { profileId?: string } }>(
  sessions: readonly T[],
  hiddenPresets?: ReadonlySet<string>,
): T[] {
  const hidden = hiddenPresets ? new Set([...hiddenPresets].map((id) => id.trim().toLocaleLowerCase())) : null;
  return sessions.filter((session) => {
    if (session.archived) return false;
    const preset = session.agent?.profileId?.trim().toLocaleLowerCase();
    return !(hidden && preset && hidden.has(preset));
  });
}

/**
 * The command palette shows its own `onSearchSessions` results once the user
 * types, bypassing the filtered list it was handed — so a hidden session came
 * straight back on the first keystroke. History search returns the same index
 * rows the list does (they carry `agent.profileId`), so the same predicate
 * covers both; this wraps the callback rather than filtering inside the
 * palette so the palette stays unaware of visibility policy.
 *
 * Returns a STABLE function per (search, hiddenPresets) pair — callers must
 * memoize, since the palette re-runs its search effect whenever the callback's
 * identity changes.
 */
export function filterSearchMatches<T extends { archived?: boolean; agent?: { profileId?: string } }>(
  search: ((query: string) => Promise<T[]>) | undefined,
  hiddenPresets?: ReadonlySet<string>,
): ((query: string) => Promise<T[]>) | undefined {
  if (!search) return undefined;
  return async (query: string) => visibleChatSessions(await search(query), hiddenPresets);
}
