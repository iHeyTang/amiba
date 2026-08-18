import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import { shortId } from "@amiba/app-runtime/utils";
import {
  deleteAttachmentFile,
  useSessions,
  type Attachment,
  type ChatEngineClient,
} from "@amiba/app-runtime/core";

import { pickSendText } from "./pickSendText";

/** One user turn waiting while the model is still streaming the previous reply. */
export interface PendingChatTurn {
  queueId: string;
  text: string;
  attachments: Attachment[];
}

/** Per-session storage key for the pending-turn queue — survives reloads
 * so a fast refresh while items are queued doesn't lose them. Exported
 * so the surface can clean up its own keys when sessions are deleted. */
export function pendingQueueStorageKey(sessionId: string): string {
  return `pendingQueue:${sessionId}`;
}

/** Compact preview line for the chip row. Body trim + attachment count. */
export function previewPendingTurn(t: PendingChatTurn): string {
  const parts: string[] = [];
  const body = t.text.trim();
  if (body) parts.push(body.length > 160 ? `${body.slice(0, 157)}…` : body);
  const n = t.attachments.filter((a) => a.attachmentId && !a.uploading).length;
  if (n > 0) parts.push(n === 1 ? "(1 attachment)" : `(${n} attachments)`);
  return parts.length > 0 ? parts.join(" ") : "(empty turn)";
}

/** Shape of what runChatTurn accepts. Defined here so the hook can call
 * the surface's runChatTurn without leaking the runner's many internal
 * dependencies into this file. */
export interface RunChatTurnArgs {
  text: string;
  attachments: Attachment[];
}

/**
 * The "messages typed while the assistant is still streaming the
 * previous turn" subsystem. Owns the in-memory FIFO, its per-session
 * persistence, edit-mode, the pause flag, and the four action verbs:
 *
 *   - `send` — typing+submit path. Adds to the queue when busy, else
 *     fires `runChatTurn` directly.
   *   - `stop` — Stop button. Aborts the DSH stream, keeps the queue, and
 *     freezes auto-drain.
 *   - `sendNow(queueId)` — pre-empts the in-flight stream, seals the
 *     previous assistant locally, fires the named item immediately.
 *   - `edit(queueId)` — hoist item into composer for in-place edit.
 *
 * Pre-emption uses two refs (`suppressFinallyDrainRef`,
 * `ignoreAbortForSessionRef`) that runChatTurn's finally and the
 * stream's abort-echo handler need to read. Both are exposed for the
 * surface to wire up. See the send-now flow comments inside the
 * function for the order-of-operations cascade.
 */
export interface UsePendingQueueArgs {
  sessions: ReturnType<typeof useSessions>;
  client: ChatEngineClient;

  // Composer-side state. Owned by ChatSurface (the composer hook gives
  // ChatSurface these handles); the queue hook needs them to drain
  // composer drafts into queue items, commit edits, and clear the
  // composer after a fire.
  input: string;
  setInput: (v: string) => void;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  setAttachmentError: (v: string | null) => void;
  attachmentUploading: boolean;

  /** Clear the "from <App>" handoff chip when a fresh, non-queued send
   * fires — the chip belongs to a single turn. */
  setPendingSourceApp: (v: string | null) => void;

  // Stream-side dependencies (from useStreamBuffer + local state).
  busy: boolean;
  markCurrentAssistantStopped: () => void;
  rejectPendingTurn: (sessionId: string, err: Error) => void;

  // The actual turn runner. Lives in ChatSurface because it depends on
  // badges, history assembly, and snapshot priming. The hook calls back
  // into it for normal sends, send-now, and finally-drain.
  runChatTurn: (args: RunChatTurnArgs) => Promise<void>;
}

export interface UsePendingQueueResult {
  // State (consumed by the JSX render).
  queue: PendingChatTurn[];
  paused: boolean;
  editingQueueId: string | null;

  // Live refs that runChatTurn / the abort-echo handler read. The hook
  // owns the source of truth; the surface gets the refs so its
  // existing call sites can keep working without a behavioural change.
  queuePausedRef: React.MutableRefObject<boolean>;
  suppressFinallyDrainRef: React.MutableRefObject<boolean>;
  ignoreAbortForSessionRef: React.MutableRefObject<string | null>;

  // Cross-domain setters. `handleStreamError` clears the queue on
  // fatal engine error; the snapshot path may also need to wipe.
  setQueue: React.Dispatch<React.SetStateAction<PendingChatTurn[]>>;
  setPaused: (v: boolean) => void;
  setEditingQueueId: (v: string | null) => void;

  // Actions.
  /**
   * `textArg` is the Composer's mention-expanded send text. When present
   * it's what gets dispatched to the engine / queued; omit it to fall
   * back to the raw composer input.
   */
  send: (textArg?: string) => Promise<void>;
  stop: () => void;
  sendNow: (queueId: string) => void;
  edit: (queueId: string) => void;
  cancelEdit: () => void;
  remove: (queueId: string) => void;
  drainHead: () => void;
}

export function usePendingQueue(args: UsePendingQueueArgs): UsePendingQueueResult {
  const {
    sessions,
    client,
    input,
    setInput,
    attachments,
    setAttachments,
    setAttachmentError,
    attachmentUploading,
    setPendingSourceApp,
    busy,
    markCurrentAssistantStopped,
    rejectPendingTurn,
    runChatTurn,
  } = args;
  const { t: _t } = useT();
  void _t; // i18n hook kept stable for future copy needs

  const [queue, setQueue] = useState<PendingChatTurn[]>([]);
  const [paused, setPausedState] = useState(false);
  const queuePausedRef = useRef(false);
  useEffect(() => {
    queuePausedRef.current = paused;
  }, [paused]);
  const setPaused = useCallback((v: boolean): void => setPausedState(v), []);

  /**
   * Send-now preemption flags. When `sendNow` decides to seal the
   * in-flight turn locally and fire the next one directly (instead of
   * waiting for the engine's `aborted` echo to drive the cascade), it sets
   * these so the rest of the pipeline doesn't double-handle the
   * preemption:
   *   - `ignoreAbortForSessionRef` — silences the engine's eventual
   *     `aborted` event for the named session.
   *   - `suppressFinallyDrainRef` — skips the queue-drain in the
   *     unwinding old runChatTurn's `finally`, since we're driving
   *     the next turn directly.
   * Both are single-shot — the consumer clears on use.
   */
  const ignoreAbortForSessionRef = useRef<string | null>(null);
  const suppressFinallyDrainRef = useRef(false);

  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // Per-session persistence. The queue lives with its session: a fast
  // refresh while items are stacked up shouldn't lose them, and
  // switching tabs should bring the prior session's queue back the next
  // time it's activated.
  // ---------------------------------------------------------------------
  const queueHydratedForSessionRef = useRef<string>("");

  useEffect(() => {
    const id = sessions.activeId;
    if (!id || !sessions.ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getPlatform().storage.get(pendingQueueStorageKey(id));
        if (cancelled) return;
        const raw = res[pendingQueueStorageKey(id)];
        const restored: PendingChatTurn[] = Array.isArray(raw)
          ? (raw as PendingChatTurn[])
          : [];
        // Only adopt if the user hasn't switched again during the read.
        if (sessions.activeId !== id) return;
        // If the user already queued items during the load window
        // (clicked send while busy before storage.get resolved), keep
        // those — overwriting with the persisted snapshot would lose
        // their just-typed turn.
        setQueue((prev) => (prev.length > 0 ? prev : restored));
        queueHydratedForSessionRef.current = id;
      } catch (e) {
        console.warn("[sidepanel] load pendingQueue failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions.activeId, sessions.ready]);

  useEffect(() => {
    const id = sessions.activeId;
    if (!id) return;
    // Skip writes for sessions we haven't hydrated yet — that initial
    // [] state isn't an authoritative "queue is empty", it's just the
    // pre-load placeholder.
    if (queueHydratedForSessionRef.current !== id) return;
    if (queue.length === 0) {
      void getPlatform().storage.remove(pendingQueueStorageKey(id));
    } else {
      void getPlatform().storage.set({
        [pendingQueueStorageKey(id)]: queue,
      });
    }
  }, [queue, sessions.activeId]);

  // ---------------------------------------------------------------------
  // Actions.
  // ---------------------------------------------------------------------

  const drainHead = useCallback((): void => {
    setQueue((prev) => {
      if (prev.length === 0) return prev;
      const [head, ...tail] = prev;
      queueMicrotask(() =>
        void runChatTurn({
          text: head.text,
          attachments: head.attachments,
        }),
      );
      return tail;
    });
  }, [runChatTurn]);

  const sendNow = useCallback(
    (queueId: string): void => {
      const editingThisOne = editingQueueId === queueId;
      let item: PendingChatTurn | undefined;
      if (editingThisOne) {
        item = {
          queueId,
          text: input,
          attachments: attachments
            .filter((a) => a.attachmentId && !a.uploading)
            .map((a) => ({ ...a })),
        };
        setEditingQueueId(null);
        setInput("");
        setAttachments([]);
      } else {
        item = queue.find((q) => q.queueId === queueId);
      }
      if (!item) return;

      // The item is about to fire — remove it from the visible queue
      // now so the chip doesn't linger during the handoff.
      setQueue((prev) => prev.filter((q) => q.queueId !== queueId));
      setPausedState(false);

      const sid = sessions.activeId;
      if (busy && sid) {
        // Drive the preemption locally. Order matters:
        //   1. Set the gates BEFORE rejecting / aborting so neither the
        //      finally that fires next microtask nor the engine's echo
        //      double-handles us.
        //   2. Seal the bubble locally so the user sees `[stopped]`
        //      immediately, not after an engine round-trip.
        //   3. Reject the old pendingTurn so the old runChatTurn unwinds
        //      promptly into its finally (which we just gated).
        //   4. Fire abort to DSH — best-effort cleanup; the echoed
        //      `aborted` event hits `ignoreAbortForSessionRef` and
        //      no-ops.
        suppressFinallyDrainRef.current = true;
        ignoreAbortForSessionRef.current = sid;
        markCurrentAssistantStopped();
        rejectPendingTurn(sid, new DOMException("aborted", "AbortError"));
        try {
          client.abort(sid);
        } catch (e) {
          console.warn("[sidepanel] abort-for-send-now failed:", e);
        }
      }

      void runChatTurn({
        text: item.text,
        attachments: item.attachments,
      });
    },
    [
      editingQueueId,
      queue,
      input,
      attachments,
      sessions,
      client,
      busy,
      markCurrentAssistantStopped,
      rejectPendingTurn,
      runChatTurn,
      setInput,
      setAttachments,
    ],
  );

  const send = useCallback(async (textArg?: string): Promise<void> => {
    // `textArg` carries the Composer's mention-expanded text (`@[...]`
    // tokens turned into agent-facing text). Prefer it for the payload
    // that's DISPATCHED to the engine / QUEUED so the backend never sees
    // raw `@[type:payload]` tokens. Everything else (gating, clearing the
    // composer, attachment handling, queue bookkeeping) keeps operating on
    // the raw `input` exactly as before. Falls back to `input` for callers
    // that invoke `send()` without an expanded override.
    const text = pickSendText(textArg, input);
    // Allow send when the user has uploaded attachments but hasn't typed
    // anything (e.g. "here's a screenshot — what's wrong with it?"). We
    // still gate on having SOMETHING to send so an empty composer with
    // no attachments stays a no-op.
    if (!text && attachments.every((a) => !a.attachmentId || a.uploading)) return;
    if (attachmentUploading) return;
    if (!sessions.ready) return;

    // Edit-then-Send: clicking Send while editing a queued item means
    // "save my changes and fire this one now" — equivalent to the per-row
    // send-now button on the same item.
    if (editingQueueId != null) {
      sendNow(editingQueueId);
      return;
    }

    const attachmentsForSend = attachments.filter(
      (a) => a.attachmentId && !a.uploading,
    );

    if (busy) {
      setQueue((prev) => [
        ...prev,
        {
          queueId: shortId("q"),
          text,
          attachments: attachmentsForSend.map((a) => ({ ...a })),
        },
      ]);
      setInput("");
      setAttachments([]);
      // Page attachments are one-shot — clear so they don't
      // double-attach to a follow-up turn the user types while this
      // one is still in flight.
      setAttachmentError(null);
      // Sending a new message implicitly un-pauses: the user is
      // clearly ready for the queue to move again. The current stream
      // will finish and the finally-drain will kick in normally.
      if (queuePausedRef.current) setPausedState(false);
      return;
    }

    setInput("");
    setAttachments([]);
    setAttachmentError(null);
    // The "from <App>" chip belongs to a single hand-off turn — clear
    // it on send so it doesn't trail the user into their next prompt.
    setPendingSourceApp(null);

    // Not busy. If the queue was paused (i.e., user hit Stop and left
    // items queued), unpause first so the runChatTurn's finally-drain
    // fires the remaining items after this fresh turn completes.
    if (queuePausedRef.current) setPausedState(false);

    await runChatTurn({
      text,
      attachments: attachmentsForSend,
    });
  }, [
    input,
    attachments,
    attachmentUploading,
    sessions.ready,
    editingQueueId,
    busy,
    runChatTurn,
    setInput,
    setAttachments,
    setAttachmentError,
    setPendingSourceApp,
    sendNow,
  ]);

  const stop = useCallback((): void => {
    // Preserve the pending queue. Hitting Stop while items are queued
    // is a "halt and let me think" gesture — wiping the queue forces
    // the user to retype everything they had lined up. We freeze
    // auto-drain with `queuePaused` so the next finished stream
    // doesn't immediately fire the next queued item behind the user's
    // back.
    setPausedState(true);
    const sid = sessions.activeId;
    if (sid) {
      try {
        client.abort(sid);
      } catch (e) {
        console.warn("[sidepanel] abort failed:", e);
      }
    }
  }, [sessions.activeId, client]);

  const remove = useCallback(
    (queueId: string): void => {
      setQueue((prev) => {
        const hit = prev.find((q) => q.queueId === queueId);
        if (hit) {
          for (const a of hit.attachments) void deleteAttachmentFile(a);
        }
        return prev.filter((q) => q.queueId !== queueId);
      });
      // If we just deleted the row that was being edited, drop edit
      // mode so the composer doesn't keep a ghost reference to a
      // vanished item.
      if (editingQueueId === queueId) {
        setEditingQueueId(null);
        setInput("");
        for (const a of attachments) void deleteAttachmentFile(a);
        setAttachments([]);
      }
    },
    [editingQueueId, attachments, setInput, setAttachments],
  );

  /**
   * Enter edit mode for a queued item. The item STAYS in the queue
   * (the user explicitly asked for this — clicking edit shouldn't
   * lose the slot in the queue). The composer mirrors its content for
   * editing, the queue is paused so nothing fires past it, and the
   * editing row gets a visual marker. If the composer already had a
   * draft, that draft is appended to the queue end so nothing is lost.
   */
  const edit = useCallback(
    (queueId: string): void => {
      const item = queue.find((q) => q.queueId === queueId);
      if (!item) return;
      const draftText = input;
      const draftAttachments = attachments.filter(
        (a) => a.attachmentId && !a.uploading,
      );
      const hasDraft =
        draftText.trim().length > 0 || draftAttachments.length > 0;

      setQueue((prev) => {
        if (!hasDraft) return prev;
        return [
          ...prev,
          {
            queueId: shortId("q"),
            text: draftText,
            attachments: draftAttachments.map((a) => ({ ...a })),
          },
        ];
      });
      setEditingQueueId(queueId);
      setInput(item.text);
      setAttachments(item.attachments.map((a) => ({ ...a })));
      setPausedState(true);
    },
    [
      queue,
      input,
      attachments,
      setInput,
      setAttachments,
    ],
  );

  /** Exit edit mode without saving the composer content back to the queue. */
  const cancelEdit = useCallback((): void => {
    if (editingQueueId == null) return;
    setEditingQueueId(null);
    setInput("");
    for (const a of attachments) void deleteAttachmentFile(a);
    setAttachments([]);
  }, [editingQueueId, attachments, setInput, setAttachments]);

  return {
    queue,
    paused,
    editingQueueId,
    queuePausedRef,
    suppressFinallyDrainRef,
    ignoreAbortForSessionRef,
    setQueue,
    setPaused,
    setEditingQueueId,
    send,
    stop,
    sendNow,
    edit,
    cancelEdit,
    remove,
    drainHead,
  };
}
