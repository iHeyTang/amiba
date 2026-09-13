import type { SubmitReceipt } from "@amiba/app-runtime/protocol";
import type { ResidentTurnRequest } from "../composer/triggers/contracts";
import type { ComposerDraftDocument } from "../composer-draft-document";
import type { sessionPendingQueue, PendingChatTurn } from "./pending-queue-store";
import { deleteUnretainedAttachments, withSendingAttachments } from "./attachment-ownership";

export interface ResidentQueueDrainerDeps {
  queue(id: string): ReturnType<typeof sessionPendingQueue>;
  offscreen(id: string): boolean;
  busy(id: string): boolean;
  watchReadiness(id: string, changed: () => void): () => void;
  resolve(id: string, draft: ComposerDraftDocument, signal: AbortSignal): Promise<string>;
  send(request: ResidentTurnRequest): Promise<SubmitReceipt>;
  drainNative(id: string): void;
  retainedAttachments(): ResidentTurnRequest["attachments"];
}

type Attempt = { controller: AbortController; dispatched: boolean; completed: boolean; displaced?: boolean };

/** A real successful terminal event grants one drain, never a stored snapshot. */
export function createResidentQueueDrainer(deps: ResidentQueueDrainerDeps) {
  const attempts = new Map<string, Attempt>();
  const ownedTurns = new Set<string>();
  let enabled = true;
  const available = (id: string) => enabled && deps.offscreen(id);

  const waitUntilIdle = (id: string, attempt: Attempt) => new Promise<void>((resolve, reject) => {
    let off = () => {};
    let settled = false;
    const signal = attempt.controller.signal;
    const check = () => {
      if (settled) return;
      if (signal.aborted || !available(id) || !deps.busy(id)) {
        settled = true;
        off(); signal.removeEventListener("abort", check);
        if (signal.aborted || !available(id)) reject(new DOMException("Queue preparation cancelled", "AbortError"));
        else resolve();
      }
    };
    signal.addEventListener("abort", check, { once: true });
    off = deps.watchReadiness(id, check);
    if (settled) off();
    else check();
  });

  const drain = (id: string, allowNative: boolean) => {
    if (!enabled || deps.queue(id).isPaused()) return;
    if (!deps.offscreen(id)) {
      if (allowNative) deps.drainNative(id);
      return;
    }
    if (attempts.has(id)) return;
    const attempt: Attempt = { controller: new AbortController(), dispatched: false, completed: false };
    attempts.set(id, attempt);
    const queue = deps.queue(id);
    let selected: PendingChatTurn | undefined;
    let off = () => {};
    let accepted = false;
    void (async () => {
      try {
        await queue.ready();
        const item = queue.getSnapshot()[0];
        if (!item || queue.isPaused() || !available(id) || attempt.controller.signal.aborted) return;
        selected = item;
        const check = () => {
          attempt.controller.signal.throwIfAborted();
          if (!available(id) || queue.isPaused() || queue.getSnapshot()[0] !== item) {
            throw new DOMException("Queue preparation changed", "AbortError");
          }
        };
        off = queue.subscribe(() => {
          if (!attempt.dispatched && (queue.isPaused() || queue.getSnapshot()[0] !== item)) attempt.controller.abort();
        });
        await withSendingAttachments(item.attachments, async () => {
          await waitUntilIdle(id, attempt);
          check();
          if (item.needsResolution && !item.draft) throw new Error("Queued draft is unavailable.");
          const text = item.needsResolution
            ? await deps.resolve(id, item.draft!, attempt.controller.signal)
            : item.text;
          check();
          if (!text.trim() && !item.attachments.length) throw new Error("Queued input resolved to empty content.");
          let receipt: SubmitReceipt;
          try {
            receipt = await deps.send({ sessionId: id, text: text.trim(), attachments: item.attachments,
              signal: attempt.controller.signal, onDispatch: () => {
                check();
                attempt.dispatched = true;
                ownedTurns.add(id);
                // Match the native handoff: remove the row immediately before
                // dispatch, while the sending lease owns its attachment files.
                queue.update(rows => rows.filter(row => row.queueId !== item.queueId));
              } });
          } catch (error) {
            receipt = { kind: attempt.dispatched ? "unconfirmed" : "rejected", error: error instanceof Error ? error.message : String(error) };
          }
          if (receipt.kind === "accepted" && !attempt.dispatched) {
            receipt = { kind: "unconfirmed", error: "The sender returned no dispatch boundary." };
          }
          accepted = receipt.kind === "accepted" && receipt.command?.kind !== "error";
          if (accepted) return;
          if (attempt.dispatched) {
            ownedTurns.delete(id);
            queue.update(rows => rows.some(row => row.queueId === item.queueId) ? rows : [item, ...rows]);
          } else if (attempt.controller.signal.aborted || !available(id)) return;
          queue.setPaused(true);
          queue.setNotice(receipt.kind === "unconfirmed"
            ? `Queued submission was not confirmed. Check the conversation before retrying. ${receipt.error}`
            : receipt.kind === "accepted" ? receipt.command?.text ?? "Queued command failed." : receipt.error);
        });
      } catch (error) {
        if (!attempt.controller.signal.aborted && !(error instanceof Error && error.name === "AbortError")) {
          queue.setPaused(true);
          queue.setNotice(error instanceof Error ? error.message : String(error));
        }
      } finally {
        off();
        if (selected && !attempt.dispatched && !queue.getSnapshot().includes(selected)) {
          // A native remove/edit may have requested deletion while this
          // preparation's sending lease still protected the bytes. Recheck
          // the remaining owners after that lease has been released.
          deleteUnretainedAttachments(selected.attachments, [
            ...queue.getSnapshot().flatMap(item => item.attachments), ...deps.retainedAttachments(),
          ]);
        }
        if (attempts.get(id) === attempt) attempts.delete(id);
        if (accepted && attempt.completed && !attempt.displaced) drain(id, true);
      }
    })();
  };

  return {
    completed(id: string) {
      const owned = ownedTurns.delete(id);
      const attempt = attempts.get(id);
      if (attempt) {
        // Repeated completion notifications before dispatch do not grant a
        // second send. A new turn ending before its receipt is handled later.
        if (attempt.dispatched) attempt.completed = true;
        return;
      }
      drain(id, owned);
    },
    interrupted(id: string) {
      ownedTurns.delete(id);
      deps.queue(id).setPaused(true);
      const attempt = attempts.get(id);
      if (attempt && !attempt.dispatched) attempt.controller.abort();
    },
    displaced(id: string) {
      // Native Send now owns the replacement turn and its existing finally
      // drain. A late receipt for the displaced background turn cannot also
      // continue that queue or consume the replacement's completion.
      ownedTurns.delete(id);
      const attempt = attempts.get(id);
      if (!attempt) return;
      attempt.displaced = true;
      if (!attempt.dispatched) attempt.controller.abort();
      attempts.delete(id);
    },
    enteredForeground(id: string | null) {
      if (!id) return;
      const attempt = attempts.get(id);
      if (attempt && !attempt.dispatched) attempt.controller.abort();
    },
    setEnabled(value: boolean) {
      enabled = value;
      if (value) return;
      ownedTurns.clear();
      for (const attempt of attempts.values()) if (!attempt.dispatched) attempt.controller.abort();
    },
  };
}
