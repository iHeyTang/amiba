import type { ReactNode } from "react";

/**
 * One host-rendered row that belongs *inside* the conversation timeline
 * (an official command node's view, a manual-compaction result, …), placed
 * by `seq` between the chat messages.
 */
export interface ConversationTimelineRow {
  id: string;
  seq: number;
  content: ReactNode;
  replaceMessageId?: string;
  /** A user command echo starts its own visual turn outside assistant chrome. */
  placement?: "user";
}

/** A closed turn that has a host-rendered tail to append after it. */
export interface ConversationTurnTailAnchor {
  runtimeTurn: number;
  endSeq: number;
}

/** The host-owned rows the conversation pane has to interleave. */
export interface ConversationRows {
  readonly timelineRows: readonly ConversationTimelineRow[];
  readonly turnTailAnchors: readonly ConversationTurnTailAnchor[];
}

export const EMPTY_CONVERSATION_ROWS: ConversationRows = Object.freeze({
  timelineRows: [],
  turnTailAnchors: [],
});

/**
 * A pull-based source of {@link ConversationRows}, owned by the host.
 *
 * Why the pane subscribes instead of the shell: these rows are derived from
 * the live conversation projection, which publishes on every streamed frame.
 * Computing them in the *window shell* meant the shell re-rendered once per
 * frame, which re-rendered the whole window — sidebar history list, tabs,
 * workbench and conversation — and that render storm is what starved the work
 * a session switch was waiting on. The pane already re-renders at stream rate
 * (it renders the streaming bubble), so it reads them here instead: stream-rate
 * data re-renders only the components that display stream-rate data.
 *
 * `getSnapshot()` must return a reference that is stable while the underlying
 * conversation has not changed — the pane reads it through
 * `useSyncExternalStore`.
 */
export interface ConversationRowsSource {
  getSnapshot(): ConversationRows;
  subscribe(listener: () => void): () => void;
}

const noopUnsubscribe = (): void => {};

/** Stable fallbacks so a pane without a host keeps one subscription identity. */
export const EMPTY_CONVERSATION_ROWS_SOURCE: ConversationRowsSource = {
  getSnapshot: () => EMPTY_CONVERSATION_ROWS,
  subscribe: () => noopUnsubscribe,
};
