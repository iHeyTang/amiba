import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sessionPendingQueue, type PendingChatTurn } from "./pending-queue-store";
export { pendingQueueStorageKey, type PendingChatTurn } from "./pending-queue-store";
import { getPlatform } from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import { shortId } from "@amiba/app-runtime/utils";
import {
  useSessions,
  type Attachment,
  type ChatEngineClient,
} from "@amiba/app-runtime/core";

import type { ComposerDraftDocument } from "../composer-draft-document";
import type { ComposerDraftSource } from "../composer-draft-store";
import { captureComposerHistory } from "../composer/composer-history-state";

import { pickSendText } from "./pickSendText";
import { deleteUnretainedAttachments } from "./attachment-ownership";

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
  /** Called only after an authoritative admission receipt, never on legacy dispatch. */
  onAccepted?: () => void;
  text: string;
  attachments: Attachment[];
  /** Original editor nodes, separate from the resolved model payload. */
  draft?: ComposerDraftDocument;
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
  /** Existing transcript can be viewed but cannot receive sends or stop actions. */
  readOnly?: boolean;
  sessions: ReturnType<typeof useSessions>;
  client: ChatEngineClient;

  // Composer-side state. Owned by ChatSurface (the composer hook gives
  // ChatSurface these handles); the queue hook needs them to drain
  // composer drafts into queue items, commit edits, and clear the
  // composer after a fire.
  input: string;
  draftSource?: ComposerDraftSource;
  /** Route an edited queue row through the same codec/command pipeline as Send. */
  submitComposer?: () => boolean;
  resolveQueuedDraft?: (draft: ComposerDraftDocument, signal: AbortSignal) => Promise<string>;
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
  /** Whether the displaced turn has a local runChatTurn finally to suppress. */
  hasNativeTurn?: (sessionId: string) => boolean;
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
  /** Clear the outgoing panel projection without deleting its session queue. */
  resetView(): void;
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
    draftSource,
    submitComposer,
    resolveQueuedDraft,
    setInput,
    attachments,
    setAttachments,
    setAttachmentError,
    attachmentUploading,
    setPendingSourceApp,
    busy,
    hasNativeTurn,
    markCurrentAssistantStopped,
    rejectPendingTurn,
    runChatTurn,
  } = args;
  const readOnlyRef = useRef(args.readOnly ?? false);
  readOnlyRef.current = args.readOnly ?? false;
  const { t: _t } = useT();
  void _t; // i18n hook kept stable for future copy needs

  const [queue, setViewQueue] = useState<PendingChatTurn[]>([]);
  const queueSource = useMemo(() => sessions.activeId ? sessionPendingQueue(getPlatform().storage, sessions.activeId) : undefined, [sessions.activeId]);
  const setQueue = useCallback<React.Dispatch<React.SetStateAction<PendingChatTurn[]>>>(action => {
    if (queueSource) queueSource.update(action);
    else setViewQueue(action);
  }, [queueSource]);
  const resetView = useCallback(() => setViewQueue([]), []);
  const [paused, setPausedState] = useState(false);
  const queuePausedRef = useRef(false);
  queuePausedRef.current = queueSource?.isPaused() ?? paused;
  const setPaused = useCallback((value: boolean): void => {
    if (queueSource) queueSource.setPaused(value);
    else { queuePausedRef.current = value; setPausedState(value); }
  }, [queueSource]);

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
  useEffect(() => {
    setViewQueue([]);
    if (!queueSource || !sessions.ready) {
      queuePausedRef.current = false;
      setPausedState(false);
      return;
    }
    let active = true;
    const update = () => {
      if (!active) return;
      queuePausedRef.current = queueSource.isPaused();
      setPausedState(queuePausedRef.current);
      setViewQueue(queueSource.getSnapshot());
    };
    const off = queueSource.subscribe(update);
    update();
    return () => { active = false; off(); };
  }, [queueSource, sessions.ready]);

  // ---------------------------------------------------------------------
  // Actions.
  // ---------------------------------------------------------------------

  const queueRef = useRef(queue);
  queueRef.current = queue;
  const activeSessionRef = useRef(sessions.activeId);
  activeSessionRef.current = sessions.activeId;
  const resolutionRef = useRef<AbortController | null>(null);
  const cancelResolution = useCallback(() => {
    resolutionRef.current?.abort();
    resolutionRef.current = null;
  }, []);
  useEffect(() => cancelResolution, [sessions.activeId, args.readOnly, cancelResolution]);

  // Resolve only unsent drafts stashed by Edit. Already-submitted queue items
  // retain their original resolved model payload, including across reloads.
  const prepareItem = useCallback((item: PendingChatTurn, ready: (item: PendingChatTurn) => void) => {
    if (resolutionRef.current) return;
    if (!item.needsResolution) { ready(item); return; }
    const attempt = new AbortController();
    const sessionId = sessions.activeId;
    resolutionRef.current = attempt;
    const current = () => resolutionRef.current === attempt && !attempt.signal.aborted &&
      !readOnlyRef.current && activeSessionRef.current === sessionId &&
      queueRef.current.includes(item);
    void (async () => {
      try {
        if (!item.draft || !resolveQueuedDraft) throw new Error("Queued draft resolver is unavailable");
        const text = await resolveQueuedDraft(item.draft, attempt.signal);
        if (!current()) return;
        if (!text.trim() && item.attachments.every(a => !a.attachmentId || a.uploading)) {
          throw new Error("Queued draft resolved to empty content");
        }
        setAttachmentError(null);
        ready({ ...item, text: text.trim(), needsResolution: false });
      } catch (error) {
        if (!current()) return;
        setPaused(true);
        setAttachmentError(error instanceof Error ? error.message : String(error));
      } finally {
        if (resolutionRef.current === attempt) resolutionRef.current = null;
      }
    })();
  }, [sessions.activeId, resolveQueuedDraft, setAttachmentError, setPaused]);

  const drainHead = useCallback((): void => {
    if (readOnlyRef.current) return;
    const head = queueRef.current[0];
    if (!head) return;
    prepareItem(head, (item) => {
      queueRef.current = queueRef.current.filter(row => row.queueId !== item.queueId);
      setQueue((prev) => prev.filter(row => row.queueId !== item.queueId));
      queueMicrotask(() => void runChatTurn({
        text: item.text, attachments: item.attachments,
        ...(item.draft ? { draft: item.draft } : {}),
      }));
    });
  }, [prepareItem, runChatTurn, setQueue]);

  const sendNow = useCallback(
    (queueId: string, textArg?: string): void => {
      if (readOnlyRef.current || resolutionRef.current) return;
      const editingThisOne = editingQueueId === queueId;
      if (editingThisOne && textArg === undefined && submitComposer) {
        submitComposer();
        return;
      }
      let item: PendingChatTurn | undefined;
      let onAccepted: (() => void) | undefined;
      if (editingThisOne) {
        onAccepted = draftSource && captureComposerHistory(draftSource);
        item = {
          queueId,
          text: pickSendText(textArg, input),
          ...(draftSource ? { draft: draftSource.getDocument() } : {}),
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

      prepareItem(item, (item) => {
        const original = queueRef.current.find(q => q.queueId === queueId);
        deleteUnretainedAttachments(original?.attachments ?? [], [
          ...queueRef.current.filter(q => q.queueId !== queueId).flatMap(q => q.attachments),
          ...item.attachments,
          ...(editingThisOne ? [] : attachments),
        ]);
        // The item is about to fire — remove it from the visible queue
        // now so the chip doesn't linger during the handoff.
        setQueue((prev) => prev.filter((q) => q.queueId !== queueId));
        setPaused(false);

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
          suppressFinallyDrainRef.current = hasNativeTurn?.(sid) ?? true;
          ignoreAbortForSessionRef.current = sid;
          markCurrentAssistantStopped();
          rejectPendingTurn(sid, new DOMException("aborted", "AbortError"));
        }
        // After renderer reload the Host may still be running a turn for which
        // this window has no local busy state. Send now explicitly preempts it;
        // let the authoritative session treat an already-idle interrupt as a no-op.
        if (sid) {
          try {
            client.abort(sid);
          } catch (e) {
            console.warn("[sidepanel] abort-for-send-now failed:", e);
          }
        }

        void runChatTurn({
          text: item.text,
          attachments: item.attachments,
          ...(item.draft ? { draft: item.draft } : {}),
          ...(onAccepted ? { onAccepted } : {}),
        });
      });
    },
    [
      editingQueueId,
      prepareItem,
      setQueue,
      setPaused,
      queue,
      input,
      draftSource,
      submitComposer,
      attachments,
      sessions,
      client,
      busy,
      hasNativeTurn,
      markCurrentAssistantStopped,
      rejectPendingTurn,
      runChatTurn,
      setInput,
      setAttachments,
    ],
  );

  const send = useCallback(async (textArg?: string): Promise<void> => {
    if (readOnlyRef.current || resolutionRef.current) return;
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
      sendNow(editingQueueId, textArg);
      return;
    }

    const draft = draftSource?.getDocument();
    const attachmentsForSend = attachments.filter(
      (a) => a.attachmentId && !a.uploading,
    );

    if (busy) {
      setQueue((prev) => [
        ...prev,
        {
          queueId: shortId("q"),
          text,
          ...(draft ? { draft } : {}),
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
      if (queuePausedRef.current) setPaused(false);
      return;
    }

    const onAccepted = draftSource && captureComposerHistory(draftSource);
    setInput("");
    setAttachments([]);
    setAttachmentError(null);
    // The "from <App>" chip belongs to a single hand-off turn — clear
    // it on send so it doesn't trail the user into their next prompt.
    setPendingSourceApp(null);

    // Not busy. If the queue was paused (i.e., user hit Stop and left
    // items queued), unpause first so the runChatTurn's finally-drain
    // fires the remaining items after this fresh turn completes.
    if (queuePausedRef.current) setPaused(false);

    await runChatTurn({
      text,
      ...(draft ? { draft } : {}),
      attachments: attachmentsForSend,
      ...(onAccepted ? { onAccepted } : {}),
    });
  }, [
    input,
    draftSource,
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
    setQueue,
    setPaused,
  ]);

  const stop = useCallback((): void => {
    if (readOnlyRef.current) return;
    cancelResolution();
    // Preserve the pending queue. Hitting Stop while items are queued
    // is a "halt and let me think" gesture — wiping the queue forces
    // the user to retype everything they had lined up. We freeze
    // auto-drain with `queuePaused` so the next finished stream
    // doesn't immediately fire the next queued item behind the user's
    // back.
    setPaused(true);
    const sid = sessions.activeId;
    if (sid) {
      try {
        client.abort(sid);
      } catch (e) {
        console.warn("[sidepanel] abort failed:", e);
      }
    }
  }, [sessions.activeId, client, cancelResolution, setPaused]);

  const remove = useCallback(
    (queueId: string): void => {
      cancelResolution();
      const hit = queueRef.current.find(q => q.queueId === queueId);
      const remaining = queueRef.current.filter(q => q.queueId !== queueId);
      const clearsComposer = editingQueueId === queueId;
      deleteUnretainedAttachments(
        [...(hit?.attachments ?? []), ...(clearsComposer ? attachments : [])],
        [...remaining.flatMap(q => q.attachments), ...(clearsComposer ? [] : attachments)],
      );
      queueRef.current = remaining;
      setQueue(prev => prev.filter(q => q.queueId !== queueId));
      // If we just deleted the row that was being edited, drop edit
      // mode so the composer doesn't keep a ghost reference to a
      // vanished item.
      if (editingQueueId === queueId) {
        setEditingQueueId(null);
        setInput("");
        setAttachments([]);
      }
    },
    [editingQueueId, attachments, setInput, setAttachments, cancelResolution, setQueue],
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
      cancelResolution();
      const draftText = input;
      const draft = draftSource?.getDocument();
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
            ...(draft ? { draft, needsResolution: true } : {}),
            attachments: draftAttachments.map((a) => ({ ...a })),
          },
        ];
      });
      setEditingQueueId(queueId);
      if (item.draft && draftSource) draftSource.setParts(item.draft.parts);
      else setInput(item.text);
      setAttachments(item.attachments.map((a) => ({ ...a })));
      setPaused(true);
    },
    [
      queue,
      setQueue,
      setPaused,
      input,
      draftSource,
      cancelResolution,
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
    deleteUnretainedAttachments(attachments, queueRef.current.flatMap(q => q.attachments));
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
    resetView,
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
