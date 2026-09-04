/**
 * Session-list visibility policy, split into the two independent concerns it
 * always was:
 *
 * - **Hidden presets** (`visibleChatSessions`) — a plugin may hide every
 *   session bound to one of its agent presets (the steward's own conversation
 *   is the first such case). Those sessions stay openable by id, they just
 *   leave every list. This one is policy: it applies everywhere.
 * - **Archived** (`activeChatSessions`) — a *view* choice, not policy.
 *   Archiving is now the only "get this out of my list" action Amiba has and
 *   DSH ships no unarchive, so the history list MUST still receive archived
 *   rows: `SessionsListView` owns the Active/Archived toggle and can only
 *   render it when at least one archived row reaches it. Filtering archived
 *   rows out upstream would make an archived session unreachable forever.
 *
 * Quick pickers — the command palette and Quick-Ask's `SessionDrawer` — have
 * no such toggle and are for resuming live work, so they deliberately keep
 * excluding archived rows via `activeChatSessions` / `filterSearchMatches`.
 */

type VisibilityCandidate = { archived?: boolean; agent?: { profileId?: string } };

/**
 * The list-facing filter: hidden presets only. Archived rows pass through so
 * the history list's own archived view has something to show.
 */
export function visibleChatSessions<T extends VisibilityCandidate>(
  sessions: readonly T[],
  hiddenPresets?: ReadonlySet<string>,
): T[] {
  const hidden = hiddenPresets ? new Set([...hiddenPresets].map((id) => id.trim().toLocaleLowerCase())) : null;
  if (!hidden?.size) return [...sessions];
  return sessions.filter((session) => {
    const preset = session.agent?.profileId?.trim().toLocaleLowerCase();
    return !(preset && hidden.has(preset));
  });
}

/**
 * The quick-picker filter: hidden presets AND archived. For surfaces that
 * offer no archived view of their own (command palette, Quick-Ask drawer),
 * where an archived row would only be noise.
 */
export function activeChatSessions<T extends VisibilityCandidate>(
  sessions: readonly T[],
  hiddenPresets?: ReadonlySet<string>,
): T[] {
  return visibleChatSessions(sessions, hiddenPresets).filter(
    (session) => !session.archived,
  );
}

/**
 * The command palette shows its own `onSearchSessions` results once the user
 * types, bypassing the filtered list it was handed — so a hidden session came
 * straight back on the first keystroke. History search returns the same index
 * rows the list does (they carry `agent.profileId`), so the same predicate
 * covers both; this wraps the callback rather than filtering inside the
 * palette so the palette stays unaware of visibility policy.
 *
 * The palette is a quick picker, so this applies `activeChatSessions` —
 * archived rows are excluded here on purpose; the sidebar's archived view is
 * where they are found again.
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
  return async (query: string) => activeChatSessions(await search(query), hiddenPresets);
}
