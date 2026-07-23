import { useCallback, useEffect, useRef } from "react";
import { shortId } from "@amiba/utils";
import {
  useSessions,
  type ChatRuntimeState,
  type HermesToolProgress,
  type StreamedToolCall,
} from "@amiba/core";

import type { AssistantTimelineItem, UiMessage } from "./types";

/**
 * The chunk-buffer / verbose-timeline / RAF-flush machinery for an
 * in-flight chat stream. Lives between the engine's stream events and
 * the per-message React state: events go into refs; refs flush into
 * `setActiveMessages` at most once per animation frame so a long reply
 * doesn't re-render Streamdown hundreds of times per second.
 *
 * The hook owns:
 *   - **streamChunkBufRef** — accumulates `delta.content` for the
 *     currently-streaming assistant message; flushed into `m.content`
 *     by `flushStreamChunksToMessages`.
 *   - **verboseStateRef** — the timeline (text/tool/approval items),
 *     reasoning string, and tool-call list. Flushed into the message's
 *     `assistantTimeline`, `reasoning`, `streamVerbose`,
 *     `hermesToolProgress` by `applyVerboseToAssistant`.
 *   - Two RAF handles so back-to-back schedules coalesce.
 *
 * It does NOT own the wire subscription (`client.onStreamEvent` /
 * `client.onSnapshot`) — that stays in `ChatSurface` with the event
 * router that needs cross-domain context (approvals, queue, error).
 * The router calls the imperative methods we return on each event.
 */
export interface UseStreamBufferArgs {
  sessions: ReturnType<typeof useSessions>;
}

interface ChunkSlot {
  assistantUiId: string;
  pending: string;
}

interface VerboseSlot {
  assistantUiId: string;
  reasoning: string;
  tools: StreamedToolCall[];
  hermesOrder: string[];
  hermesById: Map<string, HermesToolProgress>;
  timeline: AssistantTimelineItem[];
}

export interface UseStreamBufferResult {
  /** Returns the uiId of the assistant message currently being
   * accumulated, if any. Used by callers that need to attach things
   * (approval records, abort markers) to the right bubble. */
  getCurrentAssistantUiId: () => string | undefined;

  // --- Lifecycle -----------------------------------------------------
  /** Set up both refs for a new turn. Call from runChatTurn just before
   * `client.submit` so events coming back from the SW find populated
   * accumulators to mutate. */
  prime: (assistantUiId: string) => void;
  /** "Begin" event helper: only initializes refs if they're not set yet
   * (a previous `prime` from runChatTurn typically beat us here, but
   * snapshot-rejoin paths can mean begin lands first). */
  onBegin: (assistantUiId: string) => void;
  /** Cancel both RAFs and null out both refs. Used on session switch,
   * fresh chat, and (with a preceding `flushNow`) on terminal events. */
  reset: () => void;
  /** Rebuild both refs from a runtime-state snapshot. Used when the
   * panel mounts onto a session that was already streaming in another
   * tab — the SW's accumulated state seeds our local view. */
  hydrateFromSnapshot: (state: ChatRuntimeState) => void;

  // --- Stream-event handlers -----------------------------------------
  /** Append a `delta.content` chunk. Schedules a flush. */
  onChunk: (text: string) => void;
  /** Replace the latest ephemeral progress note. Schedules a verbose flush. */
  onReasoning: (text: string) => void;
  /** Overwrite the running tool-call list. Schedules a verbose flush. */
  onToolCalls: (calls: StreamedToolCall[]) => void;
  /** Record a Hermes tool-progress event in stable order. */
  onHermesToolProgress: (ev: HermesToolProgress) => void;
  /** Push an approval marker into the verbose timeline so the chip
   * renders inline. Idempotent on `approvalId`. */
  onApprovalToTimeline: (approvalId: string) => void;

  // --- Flush controls (for terminal handlers) ------------------------
  /** Cancel any in-flight chunk-flush RAF without flushing. */
  cancelStreamChunkFlush: () => void;
  /** Cancel any in-flight verbose-flush RAF without flushing. */
  cancelVerboseFlush: () => void;
  /** Immediate flush of any buffered chunks. */
  flushStreamChunksToMessages: () => void;
  /** Immediate apply of the verbose state to the assistant message. */
  applyVerboseToAssistant: () => void;
  /** Schedule a verbose flush on the next animation frame. */
  scheduleVerboseFlush: () => void;
}

export function useStreamBuffer(args: UseStreamBufferArgs): UseStreamBufferResult {
  const { sessions } = args;

  const streamChunkBufRef = useRef<ChunkSlot | null>(null);
  const streamFlushRafRef = useRef<number | null>(null);
  const verboseStateRef = useRef<VerboseSlot | null>(null);
  const verboseFlushRafRef = useRef<number | null>(null);

  const cancelStreamChunkFlush = useCallback((): void => {
    if (streamFlushRafRef.current != null) {
      cancelAnimationFrame(streamFlushRafRef.current);
      streamFlushRafRef.current = null;
    }
  }, []);

  const flushStreamChunksToMessages = useCallback((): void => {
    const slot = streamChunkBufRef.current;
    if (!slot || slot.pending.length === 0) return;
    const delta = slot.pending;
    slot.pending = "";
    const uiId = slot.assistantUiId;
    sessions.setActiveMessages((prev) => {
      const next = (prev as UiMessage[]).slice();
      const i = next.findIndex((m) => m.uiId === uiId);
      if (i >= 0) {
        next[i] = { ...next[i], content: next[i].content + delta };
      }
      return next;
    });
  }, [sessions]);

  const scheduleStreamChunkFlush = useCallback((): void => {
    if (streamFlushRafRef.current != null) return;
    streamFlushRafRef.current = requestAnimationFrame(() => {
      streamFlushRafRef.current = null;
      flushStreamChunksToMessages();
      if (streamChunkBufRef.current?.pending) {
        scheduleStreamChunkFlush();
      }
    });
  }, [flushStreamChunksToMessages]);

  // Always cancel any pending RAF on unmount.
  useEffect(() => {
    return () => {
      cancelStreamChunkFlush();
    };
  }, [cancelStreamChunkFlush]);

  const appendTextToVerboseTimeline = useCallback((delta: string): void => {
    const v = verboseStateRef.current;
    if (!v) return;
    const last = v.timeline[v.timeline.length - 1];
    if (last && last.kind === "text") {
      last.text += delta;
    } else {
      v.timeline.push({ kind: "text", id: shortId("tl"), text: delta });
    }
  }, []);

  const appendToolToVerboseTimeline = useCallback((toolCallId: string): void => {
    const v = verboseStateRef.current;
    if (!v) return;
    const seen = v.timeline.some(
      (it) => it.kind === "tool" && it.toolCallId === toolCallId,
    );
    if (seen) return;
    v.timeline.push({ kind: "tool", id: shortId("tl"), toolCallId });
  }, []);

  const appendApprovalToVerboseTimeline = useCallback(
    (approvalId: string): void => {
      const v = verboseStateRef.current;
      if (!v) return;
      const seen = v.timeline.some(
        (it) => it.kind === "approval" && it.approvalId === approvalId,
      );
      if (seen) return;
      v.timeline.push({
        kind: "approval",
        id: shortId("tl"),
        approvalId,
      });
    },
    [],
  );

  const cancelVerboseFlush = useCallback((): void => {
    if (verboseFlushRafRef.current != null) {
      cancelAnimationFrame(verboseFlushRafRef.current);
      verboseFlushRafRef.current = null;
    }
  }, []);

  const applyVerboseToAssistant = useCallback((): void => {
    const v = verboseStateRef.current;
    if (!v) return;
    // Reasoning rides on its own field so the bubble renderer can fold it
    // separately from the body text. ``streamVerbose`` carries only a
    // backward-compatible aggregate of tool arguments; the progress events
    // below receive per-call details for the normal disclosure UI.
    const rs = v.reasoning.trimEnd();
    const parts: string[] = [];
    const named = v.tools.filter((tool) => tool.name);
    if (named.length > 0) {
      const blocks = named.map((tool) => {
        const argsStr = (tool.arguments || "").trimEnd();
        return `**${tool.name}**${argsStr ? `\n\n\`\`\`json\n${argsStr}\n\`\`\`` : ""}`;
      });
      parts.push(blocks.join("\n\n"));
    }
    const md = parts.join("\n\n");
    const progress = v.hermesOrder
      .map((id) => v.hermesById.get(id))
      .filter((ev): ev is HermesToolProgress => Boolean(ev));
    const progressWithDetails = progress.map((event) => {
      if (event.label && event.label.trim() !== event.tool) return event;
      const call =
        named.find((candidate) => candidate.id === event.toolCallId) ??
        named.find((candidate) => candidate.name === event.tool);
      const argumentsText = call?.arguments.trim();
      return argumentsText ? { ...event, label: argumentsText } : event;
    });
    // Snapshot the timeline so React sees a new identity for each text
    // item when its content grows (text items are mutated in place
    // during the run).
    const timelineSnapshot = v.timeline.map((it) =>
      it.kind === "text" ? { ...it } : it,
    );
    const assistantUiId = v.assistantUiId;
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) =>
        m.uiId === assistantUiId
          ? {
              ...m,
              streamVerbose: md,
              reasoning: rs || undefined,
              hermesToolProgress: progressWithDetails,
              assistantTimeline: timelineSnapshot,
            }
          : m,
      ),
    );
  }, [sessions]);

  const scheduleVerboseFlush = useCallback((): void => {
    if (verboseFlushRafRef.current != null) return;
    verboseFlushRafRef.current = requestAnimationFrame(() => {
      verboseFlushRafRef.current = null;
      applyVerboseToAssistant();
    });
  }, [applyVerboseToAssistant]);

  const prime = useCallback((assistantUiId: string): void => {
    cancelStreamChunkFlush();
    cancelVerboseFlush();
    streamChunkBufRef.current = {
      assistantUiId,
      pending: "",
    };
    verboseStateRef.current = {
      assistantUiId,
      reasoning: "",
      tools: [],
      hermesOrder: [],
      hermesById: new Map(),
      timeline: [],
    };
  }, [cancelStreamChunkFlush, cancelVerboseFlush]);

  const onBegin = useCallback((assistantUiId: string): void => {
    if (!streamChunkBufRef.current) {
      streamChunkBufRef.current = {
        assistantUiId,
        pending: "",
      };
    }
    if (!verboseStateRef.current) {
      verboseStateRef.current = {
        assistantUiId,
        reasoning: "",
        tools: [],
        hermesOrder: [],
        hermesById: new Map(),
        timeline: [],
      };
    }
  }, []);

  const reset = useCallback((): void => {
    cancelStreamChunkFlush();
    cancelVerboseFlush();
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
  }, [cancelStreamChunkFlush, cancelVerboseFlush]);

  const hydrateFromSnapshot = useCallback((state: ChatRuntimeState): void => {
    if (!state.assistantUiId) return;
    verboseStateRef.current = {
      assistantUiId: state.assistantUiId,
      reasoning: state.reasoning,
      tools: state.toolCalls.slice(),
      hermesOrder: state.hermesOrder.slice(),
      hermesById: new Map(
        state.hermesToolProgress.map(
          (e: HermesToolProgress) => [e.toolCallId, e] as const,
        ),
      ),
      // Copy text items so the in-place `last.text += delta` mutations
      // from future chunk events don't retroactively rewrite history.
      timeline: state.timeline.map((it: AssistantTimelineItem) =>
        it.kind === "text" ? { ...it } : { ...it },
      ),
    };
    if (state.streaming) {
      // The accumulator buffers later deltas on top of the snapshot's
      // accumulated text. We start `pending` empty; the next chunk
      // event appends to message.content (which the caller sets to
      // assistantText separately).
      streamChunkBufRef.current = {
        assistantUiId: state.assistantUiId,
        pending: "",
      };
    }
  }, []);

  const onChunk = useCallback(
    (text: string): void => {
      const slot = streamChunkBufRef.current;
      if (slot) slot.pending += text;
      appendTextToVerboseTimeline(text);
      scheduleStreamChunkFlush();
      scheduleVerboseFlush();
    },
    [appendTextToVerboseTimeline, scheduleStreamChunkFlush, scheduleVerboseFlush],
  );

  const onReasoning = useCallback(
    (text: string): void => {
      const v = verboseStateRef.current;
      if (v) v.reasoning = text;
      scheduleVerboseFlush();
    },
    [scheduleVerboseFlush],
  );

  const onToolCalls = useCallback(
    (calls: StreamedToolCall[]): void => {
      const v = verboseStateRef.current;
      if (v) v.tools = calls.slice();
      scheduleVerboseFlush();
    },
    [scheduleVerboseFlush],
  );

  const onHermesToolProgress = useCallback(
    (ev: HermesToolProgress): void => {
      const v = verboseStateRef.current;
      if (v) {
        if (!v.hermesById.has(ev.toolCallId)) {
          v.hermesOrder.push(ev.toolCallId);
          appendToolToVerboseTimeline(ev.toolCallId);
        }
        v.hermesById.set(ev.toolCallId, ev);
      }
      scheduleVerboseFlush();
    },
    [appendToolToVerboseTimeline, scheduleVerboseFlush],
  );

  const getCurrentAssistantUiId = useCallback((): string | undefined => {
    return (
      verboseStateRef.current?.assistantUiId ??
      streamChunkBufRef.current?.assistantUiId
    );
  }, []);

  return {
    getCurrentAssistantUiId,
    prime,
    onBegin,
    reset,
    hydrateFromSnapshot,
    onChunk,
    onReasoning,
    onToolCalls,
    onHermesToolProgress,
    onApprovalToTimeline: appendApprovalToVerboseTimeline,
    cancelStreamChunkFlush,
    cancelVerboseFlush,
    flushStreamChunksToMessages,
    applyVerboseToAssistant,
    scheduleVerboseFlush,
  };
}
