/**
 * Turn windowing for the conversation view.
 *
 * A session's history is loaded whole (the runtime paginates its decoded log,
 * but the client walks every page), so the conversation used to mount one bubble
 * tree per turn on every switch — for a long, continued session that is the
 * freeze you feel when moving between conversations. Only the newest turns are
 * rendered; scrolling up past the top sentinel pulls in the previous slice.
 *
 * Windowing is measured in *turns*, not messages, so a user turn and its replies
 * are never split across the boundary.
 */

/** Turns rendered before the user asks for earlier history. */
export const MESSAGE_TURN_WINDOW = 24;

export interface WindowedTurns<T> {
  /** Turns to render, newest last. */
  visible: readonly T[];
  /** How many older turns are still folded away. */
  hidden: number;
}

/** Keep the newest `limit` turns of `turns` (at least one). */
export function windowTurns<T>(
  turns: readonly T[],
  limit: number = MESSAGE_TURN_WINDOW,
): WindowedTurns<T> {
  const size = Math.max(1, Math.floor(limit));
  if (size >= turns.length) return { visible: turns, hidden: 0 };
  return { visible: turns.slice(turns.length - size), hidden: turns.length - size };
}
