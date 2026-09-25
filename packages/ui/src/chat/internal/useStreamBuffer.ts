import { upsertRetryTimeline, appendAssistantText, applyAssistantTextSource } from "@amiba/app-runtime/dsh-client";
import type { StreamEvent } from "@amiba/app-runtime/protocol";
import { upsertCompactionTimeline, interruptOpenCompactions } from "@amiba/app-runtime/dsh-client";
import type { CompactionUpdate } from "@amiba/app-runtime/protocol";
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
 *   - **One RAF handle + frame gate.** Every event handler marks a dirty
 *     flag and schedules a single coalesced flush. The flush drains the
 *     chunk buffer AND the verbose timeline in ONE `setActiveMessages`
 *     commit, and fires at most once every two animation frames (~30 fps).
 *     Streamdown re-parses the whole accumulated text on every render, so
 *     a 60 fps flush rate makes the markdown cost grow linearly with wall
 *     time (a 100 KB reply re-parsed 60×/s pegs the main thread and
 *     freezes the whole window) — halving the rate halves that cost while
 *     keeping the live reply visually smooth.
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
  onChunk: (text: string, runtimeStep?: number) => void;
  onAssistantTextSource: (event: Extract<StreamEvent,{kind:"assistantTextSource"}>) => void;
  /** Append a reasoning delta chunk. Schedules a coalesced flush. */
  onReasoning: (text: string) => void;
  /** Overwrite the running tool-call list. Schedules a coalesced flush. */
  onToolCalls: (calls: ToolCall[]) => void;
  /** Record a runtime tool-progress event in stable order. */
  onToolProgress: (ev: ToolProgress) => void;
  onRetry: (update: Extract<StreamEvent, {kind:"retry"}>["event"]) => void;
  onCompaction: (update: CompactionUpdate) => void;
  finishCompactions: () => void;
  /** Push an approval marker into the verbose timeline so the chip
   * renders inline. Idempotent on `approvalId`. */
  onApprovalToTimeline: (approvalId: string) => void;

  // --- Flush controls (for terminal handlers) ------------------------
  /** Cancel any in-flight streaming flush RAF without flushing. */
  cancelStreamChunkFlush: () => void;
  /** Cancel any in-flight streaming flush RAF without flushing. */
  cancelVerboseFlush: () => void;
  /** Immediate flush of any buffered chunks. */
  flushStreamChunksToMessages: () => void;
  /** Immediate apply of the verbose state to the assistant message. */
  applyVerboseToAssistant: () => void;
  /** Schedule a coalesced flush on the next animation frame (throttled). */
  scheduleVerboseFlush: () => void;
}

export function useStreamBuffer(args: UseStreamBufferArgs): UseStreamBufferResult {
  const { sessions } = args;

  const streamChunkBufRef = useRef<ChunkSlot | null>(null);
  const verboseStateRef = useRef<VerboseSlot | null>(null);
  const flushRafRef = useRef<number | null>(null);
  /** Flush at most once per two animation frames. See {@link scheduleFlush}. */
  const frameRef = useRef(0);
  /** Set by every event handler; cleared by the coalesced flush. Lets the
   * scheduler skip a frame when only one of the two schedulers fired. */
  const dirtyRef = useRef(false);

  const markDirty = useCallback((): void => {
    dirtyRef.current = true;
  }, []);

  const cancelFlush = useCallback((): void => {
    if (flushRafRef.current != null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
  }, []);

  const cancelStreamChunkFlush = cancelFlush;
  const cancelVerboseFlush = cancelFlush;

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

  // Always cancel any pending RAF on unmount.
  useEffect(() => {
    return () => {
      cancelFlush();
    };
  }, [cancelFlush]);

  const appendTextToVerboseTimeline = useCallback((delta: string, runtimeStep?: number): void => {
    const v = verboseStateRef.current;
    if (v) appendAssistantText(v.timeline, delta, () => shortId("tl"), runtimeStep);
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

  /** Derive the per-message fields a verbose snapshot contributes. */
  const buildVerbosePatch = useCallback((v: VerboseSlot) => {
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
      it.kind === "text" || it.kind === "reasoning" ? { ...it } : it,
    );
    const reasoningMs =
      v.reasoningStartAt !== null && v.reasoningEndAt !== null
        ? Math.max(0, v.reasoningEndAt - v.reasoningStartAt)
        : undefined;
    const processMs =
      v.processFirstAt !== null && v.processLastAt !== null
        ? Math.max(0, v.processLastAt - v.processFirstAt)
        : undefined;
    return {
      streamVerbose: md,
      reasoning: rs || undefined,
      ...(rs && reasoningMs !== undefined ? { reasoningMs } : {}),
      ...(processMs !== undefined ? { processMs } : {}),
      toolProgress: progressWithDetails,
      assistantTimeline: timelineSnapshot,
    };
  }, []);

  /** Immediate apply of the verbose state to the assistant message. */
  const applyVerboseToAssistant = useCallback((): void => {
    const v = verboseStateRef.current;
    if (!v) return;
    const assistantUiId = v.assistantUiId;
    const patch = buildVerbosePatch(v);
    sessions.setActiveMessages((prev) =>
      (prev as UiMessage[]).map((m) =>
        m.uiId === assistantUiId ? { ...m, ...patch } : m,
      ),
    );
  }, [buildVerbosePatch, sessions]);

  /** Drain chunk buffer AND verbose timeline in ONE commit (one re-render). */
  const flushBuffers = useCallback((): void => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    const slot = streamChunkBufRef.current;
    const delta = slot?.pending ?? "";
    if (slot) slot.pending = "";
    const v = verboseStateRef.current;
    if (delta.length === 0 && !v) return;
    const uiId = slot?.assistantUiId ?? v?.assistantUiId;
    if (!uiId) return;
    const patch = v ? buildVerbosePatch(v) : null;
    sessions.setActiveMessages((prev) => {
      const next = (prev as UiMessage[]).slice();
      const i = next.findIndex((m) => m.uiId === uiId);
      if (i < 0) return prev;
      next[i] = {
        ...next[i],
        ...(delta.length > 0 ? { content: next[i].content + delta } : {}),
        ...(patch ?? {}),
      };
      return next;
    });
    // A chunk that lands between the dirty check and the drain (impossible
    // on one thread, but terminal flushes run outside the RAF path) stays
    // pending for the next scheduled flush.
    if (streamChunkBufRef.current?.pending) markDirty();
  }, [buildVerbosePatch, sessions, markDirty]);

  /**
   * Coalesced, throttled scheduler: at most one flush per animation frame
   * and at most one flush per two frames (~30 fps), one commit per flush.
   * The streaming bubble re-parses its whole accumulated markdown on every
   * commit, so flushing every frame makes that cost grow with wall time; the
   * frame gate halves it while keeping the live reply visually smooth.
   */
  const scheduleFlush = useCallback((): void => {
    if (flushRafRef.current != null) return;
    if (!dirtyRef.current) return;
    flushRafRef.current = requestAnimationFrame(() => {
      flushRafRef.current = null;
      if (!dirtyRef.current) return;
      frameRef.current += 1;
      if (frameRef.current % 2 === 0) flushBuffers();
      if (dirtyRef.current) scheduleFlush();
    });
  }, [flushBuffers]);

  const scheduleVerboseFlush = scheduleFlush;

  const prime = useCallback((assistantUiId: string): void => {
    cancelFlush();
    dirtyRef.current = false;
    frameRef.current = 0;
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
  }, [cancelFlush]);

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
    cancelFlush();
    dirtyRef.current = false;
    frameRef.current = 0;
    streamChunkBufRef.current = null;
    verboseStateRef.current = null;
  }, [cancelFlush]);

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
    (text: string, runtimeStep?: number): void => {
      const slot = streamChunkBufRef.current;
      if (slot) slot.pending += text;
      appendTextToVerboseTimeline(text, runtimeStep);
      markDirty();
      scheduleFlush();
    },
    [appendTextToVerboseTimeline, markDirty, scheduleFlush],
  );

  const onAssistantTextSource = useCallback((event: Extract<StreamEvent,{kind:"assistantTextSource"}>) => {
    const v = verboseStateRef.current;
    if (v) applyAssistantTextSource(v.timeline, event);
    markDirty();
    scheduleFlush();
  }, [markDirty, scheduleFlush]);

  const onReasoning = useCallback(
    (text: string): void => {
      const v = verboseStateRef.current;
      // DSH sends reasoning as true deltas (the chat engine and the history
      // projection both accumulate with `+=`); append here too or the live
      // view shows only the latest fragment and the folded post-turn block
      // collapses to the final (often whitespace-only) delta.
      if (v) {
        v.reasoning += text;
        const last = v.timeline.at(-1);
        if (last?.kind === "reasoning") { last.text += text; last.endedAt = Date.now(); }
        else v.timeline.push({kind:"reasoning",id:shortId("tl"),text,startedAt:Date.now(),endedAt:Date.now()});
        const now = Date.now();
        if (v.reasoningStartAt === null) v.reasoningStartAt = now;
        v.reasoningEndAt = now;
        if (v.processFirstAt === null) v.processFirstAt = now;
        v.processLastAt = now;
      }
      markDirty();
      scheduleFlush();
    },
    [markDirty, scheduleFlush],
  );

  const onToolCalls = useCallback(
    (calls: ToolCall[]): void => {
      const v = verboseStateRef.current;
      if (v) v.tools = calls.slice();
      markDirty();
      scheduleFlush();
    },
    [markDirty, scheduleFlush],
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
      markDirty();
      scheduleFlush();
    },
    [appendToolToVerboseTimeline, markDirty, scheduleFlush],
  );

  const onRetry = useCallback((update: Extract<StreamEvent, {kind:"retry"}>["event"]): void => {
    const v = verboseStateRef.current;
    if (v) upsertRetryTimeline(v.timeline, update);
    markDirty();
    scheduleFlush();
  }, [markDirty, scheduleFlush]);

  const onCompaction = useCallback((update: CompactionUpdate): void => {
    const v = verboseStateRef.current;
    if (v) upsertCompactionTimeline(v.timeline, update);
    markDirty();
    scheduleFlush();
  }, [markDirty, scheduleFlush]);

  const finishCompactions = useCallback((): void => {
    const v = verboseStateRef.current;
    if (v) interruptOpenCompactions(v.timeline);
  }, []);

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
    onAssistantTextSource,
    onReasoning,
    onToolCalls,
    onToolProgress,
    onRetry,
    onCompaction,
    finishCompactions,
    onApprovalToTimeline: appendApprovalToVerboseTimeline,
    cancelStreamChunkFlush,
    cancelVerboseFlush,
    flushStreamChunksToMessages,
    applyVerboseToAssistant,
    scheduleVerboseFlush,
  };
}
