/** Exclude delegated subagent sessions and exact plugin-owned IDs from ordinary history. */
type VisibilityCandidate = { origin?: "subagent"; id?: string; archived?: boolean; agent?: { profileId?: string } };

export function visibleChatSessions<T extends VisibilityCandidate>(
  sessions: readonly T[], hiddenSessionIds?: ReadonlySet<string>,
): T[] {
  return sessions.filter((session) => !session.archived && session.origin !== "subagent" && !isRuntimeOwnedSession(session, hiddenSessionIds));
}

export function isRuntimeOwnedSession<T extends VisibilityCandidate>(
  session: T | undefined, hiddenSessionIds?: ReadonlySet<string>,
): boolean {
  return !!session?.id && hiddenSessionIds?.has(session.id) === true;
}

export function filterSearchMatches<T extends VisibilityCandidate>(
  search: ((query: string) => Promise<T[]>) | undefined, hiddenSessionIds?: ReadonlySet<string>,
): ((query: string) => Promise<T[]>) | undefined {
  if (!search) return undefined;
  return async (query) => visibleChatSessions(await search(query), hiddenSessionIds);
}
