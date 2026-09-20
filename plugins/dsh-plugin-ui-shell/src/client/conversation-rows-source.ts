import type { ReactNode } from "react";
import type { CommandRowOwner } from "@amiba/extension-sdk";
import { EMPTY_CONVERSATION_ROWS, type ConversationRows, type ConversationRowsSource } from "@amiba/ui";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";

import { commandTimelineRows } from "./command-rows.js";
import type { ConversationSnapshot } from "./conversation-snapshot.js";
import { turnTailAnchorsOf } from "./turn-tail.js";

/** Sentinel so a genuine `undefined` snapshot is still a cache hit. */
const MISS = Symbol("conversation-rows-miss");

/**
 * Build the conversation pane's row source from the live conversation
 * projection.
 *
 * The rows are derived lazily, when the pane reads them, and cached against
 * the projection's own snapshot identity. That is the whole point: the OLD
 * shape subscribed to the projection *in the product shell*, so every streamed
 * frame re-rendered the shell — and therefore the entire window: sidebar
 * history list, tab bar, workbench and conversation. That render storm is what
 * made switching to another session while a reply was still printing feel
 * frozen, because the renderer spent its frames re-deriving rows for the
 * conversation the user was leaving instead of draining the storage and wire
 * work the switch was waiting on.
 *
 * The pane re-renders per streamed frame regardless (it renders the streaming
 * bubble), so reading the rows there costs nothing extra, and the shell stays
 * out of the stream-rate path entirely.
 */
export function createConversationRowsSource(
  source: ObservableSnapshot<ConversationSnapshot | undefined> | undefined,
  commandRowKeys: ObservableSnapshot<readonly string[]>,
  renderCommandRow: (owner: CommandRowOwner) => ReactNode,
): ConversationRowsSource {
  let cachedFor: ConversationSnapshot | undefined | typeof MISS = MISS;
  let cachedKeys: readonly string[] | typeof MISS = MISS;
  let cached: ConversationRows = EMPTY_CONVERSATION_ROWS;

  const read = (): ConversationRows => {
    const snapshot = source?.getSnapshot();
    const keys = commandRowKeys.getSnapshot();
    // `getSnapshot()` is called by React more than once per render and must
    // return an identical reference while nothing has changed.
    if (cachedFor === snapshot && cachedKeys === keys) return cached;
    cachedFor = snapshot;
    cachedKeys = keys;
    cached = {
      timelineRows: commandTimelineRows(snapshot, keys, renderCommandRow),
      turnTailAnchors: turnTailAnchorsOf(snapshot),
    };
    return cached;
  };

  return {
    getSnapshot: read,
    subscribe(listener) {
      const offSource = source?.subscribe(listener) ?? (() => {});
      const offKeys = commandRowKeys.subscribe(listener);
      return () => {
        offKeys();
        offSource();
      };
    },
  };
}
