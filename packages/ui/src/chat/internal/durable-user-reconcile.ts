import type { UiMessage } from "./types";

/**
 * Upgrade optimistic user bubbles to their durable twins after a completed
 * turn.
 *
 * The composer appends a local-only bubble at send time: text plus the
 * attachment chips derived from the browser draft. The engine then persists
 * the same message into its event log, where an attached image travels as a
 * native image part with a durable, session-readable reference. Reading the
 * history back (a tab switch, a reload) projects that form — so the SAME
 * message used to render two ways depending on whether a reload had
 * happened: a capsule chip at the top-left while optimistic, and an image
 * preview at the bottom-right after any reload.
 *
 * This merger is the deterministic form of that reload: it replaces each
 * still-optimistic user bubble with its projected twin, giving the live
 * view the durable identity (`uiId` / `runtimeSeq`) and the native image
 * previews exactly as the next reload would. Nothing else is touched — the
 * streaming-settled assistant bubbles, plugin rows and notices keep their
 * current presentation, and a user message whose durable twin carries no
 * images (a plain text or file-only turn) stays exactly as it is.
 *
 * Matching is by order over the user subsequence plus identical text, so
 * interleaved notices never shift alignment and a repeated prompt pairs
 * with its own twin rather than an earlier one.
 */
export function mergeDurableUserMessages(
  active: readonly UiMessage[],
  durable: readonly UiMessage[],
): { messages: UiMessage[]; changed: boolean } {
  // Only real user turns appear in the pairing walk; notices render as
  // collapsed context rows and have no optimistic counterpart.
  const durableUsers = durable.filter(
    (message) => message.role === "user" && !message.notice,
  );
  if (durableUsers.length === 0) {
    return { messages: [...active], changed: false };
  }
  let changed = false;
  const messages = active.map((message) => {
    if (message.role !== "user" || message.notice) return message;
    // Already carries durable identity (came from a history read).
    if (message.runtimeSeq !== undefined) return message;
    for (let index = 0; index < durableUsers.length; index += 1) {
      const twin = durableUsers[index];
      if (twin.content !== message.content) continue;
      // Consume the twin so a repeated prompt pairs with its own turn.
      durableUsers.splice(index, 1);
      // Only an image twin changes anything: a twin without images adds
      // nothing over the optimistic bubble, so keep the chip-only form.
      if (!twin.images || twin.images.length === 0) return message;
      changed = true;
      return {
        ...twin,
        // Optimistic-only presentation extras the durable log does not
        // carry survive the upgrade.
        ...(message.workspacePath
          ? { workspacePath: message.workspacePath }
          : {}),
        sentAt: twin.sentAt ?? message.sentAt,
      } as UiMessage;
    }
    return message;
  });
  return { messages, changed };
}
