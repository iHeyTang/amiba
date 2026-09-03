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
