import { useCallback, useEffect, useRef } from "react";
import { shortId } from "@amiba/app-runtime/utils";
import {
  useSessions,
  type ChatRuntimeState,
  type ToolProgress,
  type ToolCall,
} from "@amiba/app-runtime/core";

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
 *     `toolProgress` by `applyVerboseToAssistant`.
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
  reasoningStartAt: number | null;
  reasoningEndAt: number | null;
  processFirstAt: number | null;
  processLastAt: number | null;
  tools: ToolCall[];
  toolOrder: string[];
  toolsById: Map<string, ToolProgress>;
  timeline: AssistantTimelineItem[];
}

export interface UseStreamBufferResult {
  /** Returns the uiId of the assistant message currently being
   * accumulated, if any. Used by callers that need to attach things
   * (approval records, abort markers) to the right bubble. */
  getCurrentAssistantUiId: () => string | undefined;

  // --- Lifecycle -----------------------------------------------------
  /** Set up both refs for a new turn. Call from runChatTurn just before
   * `client.submit` so immediate DSH events find populated
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
   * view — the engine snapshot seeds our local view. */
  hydrateFromSnapshot: (state: ChatRuntimeState) => void;

  // --- Stream-event handlers -----------------------------------------
  /** Append a `delta.content` chunk. Schedules a flush. */
  onChunk: (text: string) => void;
  /** Append a reasoning delta chunk. Schedules a verbose flush. */
  onReasoning: (text: string) => void;
  /** Overwrite the running tool-call list. Schedules a verbose flush. */
  onToolCalls: (calls: ToolCall[]) => void;
  /** Record a runtime tool-progress event in stable order. */
  onToolProgress: (ev: ToolProgress) => void;
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
    const progress = v.toolOrder
      .map((id) => v.toolsById.get(id))
      .filter((ev): ev is ToolProgress => Boolean(ev));
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
    const reasoningMs =
      v.reasoningStartAt !== null && v.reasoningEndAt !== null
        ? Math.max(0, v.reasoningEndAt - v.reasoningStartAt)
        : undefined;
    const processMs =
      v.processFirstAt !== null && v.processLastAt !== null
        ? Math.max(0, v.processLastAt - v.processFirstAt)
        : undefined;
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) =>
        m.uiId === assistantUiId
          ? {
              ...m,
              streamVerbose: md,
              reasoning: rs || undefined,
              ...(rs && reasoningMs !== undefined ? { reasoningMs } : {}),
              ...(processMs !== undefined ? { processMs } : {}),
              toolProgress: progressWithDetails,
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
      reasoningStartAt: null,
      reasoningEndAt: null,
      processFirstAt: null,
      processLastAt: null,
      tools: [],
      toolOrder: [],
      toolsById: new Map(),
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
        reasoningStartAt: null,
        reasoningEndAt: null,
        processFirstAt: null,
        processLastAt: null,
        tools: [],
        toolOrder: [],
        toolsById: new Map(),
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
      reasoningStartAt: state.reasoningStartedAt,
      reasoningEndAt: state.reasoningEndedAt,
      processFirstAt: state.reasoningStartedAt,
      processLastAt: state.reasoningEndedAt,
      tools: state.toolCalls.slice(),
      toolOrder: state.toolOrder.slice(),
      toolsById: new Map(
        state.toolProgress.map(
          (e: ToolProgress) => [e.toolCallId, e] as const,
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
      // DSH sends reasoning as true deltas (the chat engine and the history
      // projection both accumulate with `+=`); append here too or the live
      // view shows only the latest fragment and the folded post-turn block
      // collapses to the final (often whitespace-only) delta.
      if (v) {
        v.reasoning += text;
        const now = Date.now();
        if (v.reasoningStartAt === null) v.reasoningStartAt = now;
        v.reasoningEndAt = now;
        if (v.processFirstAt === null) v.processFirstAt = now;
        v.processLastAt = now;
      }
      scheduleVerboseFlush();
    },
    [scheduleVerboseFlush],
  );

  const onToolCalls = useCallback(
    (calls: ToolCall[]): void => {
      const v = verboseStateRef.current;
      if (v) v.tools = calls.slice();
      scheduleVerboseFlush();
    },
    [scheduleVerboseFlush],
  );

  const onToolProgress = useCallback(
    (ev: ToolProgress): void => {
      const v = verboseStateRef.current;
      if (v) {
        const now = Date.now();
        if (v.processFirstAt === null) v.processFirstAt = now;
        v.processLastAt = now;
        if (!v.toolsById.has(ev.toolCallId)) {
          v.toolOrder.push(ev.toolCallId);
          appendToolToVerboseTimeline(ev.toolCallId);
        }
        v.toolsById.set(ev.toolCallId, ev);
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
    onToolProgress,
    onApprovalToTimeline: appendApprovalToVerboseTimeline,
    cancelStreamChunkFlush,
    cancelVerboseFlush,
    flushStreamChunksToMessages,
    applyVerboseToAssistant,
    scheduleVerboseFlush,
  };
}
