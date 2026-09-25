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
 * are never split across the boundary. DSH emits one assistant message per tool
 * step, so a single user turn can hold dozens of replies (and a whole session
 * can hold hundreds of messages inside a handful of turns). A turn-count window
 * alone therefore still mounts megabytes of DOM for tool-heavy sessions, so the
 * window is additionally bounded by a message-count cap: older turns are folded
 * until the visible turns fit under the cap (the newest turn is always kept
 * whole, so a running reply is never hidden).
 */

/** Turns rendered before the user asks for earlier history. */
export const MESSAGE_TURN_WINDOW = 24;

/**
 * Hard ceiling on the number of messages (user prompts + assistant replies +
 * host timeline rows) the conversation view mounts at once. Long sessions with
 * few, tool-heavy turns would otherwise render their entire history — hundreds
 * of bubbles whose markdown, tool rows and images are re-reconciled on every
 * streaming flush.
 */
export const MESSAGE_DOM_CAP = 160;

export interface WindowedTurns<T> {
  /** Turns to render, newest last. */
  visible: readonly T[];
  /** How many older turns are still folded away. */
  hidden: number;
}

export interface WindowTurnsOptions<T> {
  /**
   * Optional message-count bound. Turns are folded from the oldest end until
   * `countMessages(visibleTurns) <= maxMessages`, keeping whole turns (and
   * always the newest turn) intact. When both this and `limit` apply, the
   * stricter window wins.
   */
  maxMessages?: number;
  /** Size of a turn in messages; required for `maxMessages` to apply. */
  countMessages?: (turn: T) => number;
}

/** Keep the newest `limit` turns of `turns` (at least one). */
export function windowTurns<T>(
  turns: readonly T[],
  limit: number = MESSAGE_TURN_WINDOW,
  options: WindowTurnsOptions<T> = {},
): WindowedTurns<T> {
  const size = Math.max(1, Math.floor(limit));
  let start = Math.max(0, turns.length - size);
  const { maxMessages, countMessages } = options;
  if (
    maxMessages !== undefined &&
    maxMessages > 0 &&
    countMessages &&
    turns.length > 0
  ) {
    // Fold the oldest turns until the visible slice fits under the cap. The
    // newest turn is always kept, so a single oversized streaming turn still
    // renders whole.
    let sliced = turns.length - 1;
    let count = countMessages(turns[sliced]);
    while (sliced > 0) {
      const older = sliced - 1;
      const nextCount = count + countMessages(turns[older]);
      if (nextCount > maxMessages) break;
      count = nextCount;
      sliced = older;
    }
    start = Math.max(start, sliced);
  }
  if (start === 0) return { visible: turns, hidden: 0 };
  return { visible: turns.slice(start), hidden: start };
}