import { waitForHomeDraftHandoff } from "../home/home-draft-handoff";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { PendingPromptResult } from "./internal/capabilities";

type Drain = () => Promise<PendingPromptResult | null>;
function createInbox() {
  let queue: PendingPromptResult[] = [];
  const listeners = new Set<() => void>();
  return {
    draining: Promise.resolve(),
    read: () => queue,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update: (change: (rows: PendingPromptResult[]) => PendingPromptResult[]) => {
      queue = change(queue); for (const listener of listeners) listener();
    },
  };
}
// A session slot can remount the recipient after storage has been drained.
// Keep ownership beside the stable Host drain capability until delivery succeeds.
const inboxes = new WeakMap<Drain, ReturnType<typeof createInbox>>();
const emptyInbox = createInbox();
function inboxFor(drain?: Drain) {
  if (!drain) return emptyInbox;
  let inbox = inboxes.get(drain);
  if (!inbox) { inbox = createInbox(); inboxes.set(drain, inbox); }
  return inbox;
}

/** An addressed home prompt must wait for the destination render before seeding
 * the composer; otherwise autosend can use the previous conversation's closure. */
export function usePendingPromptHandoff({ activeId, drain, tick, open, receive, onError }: {
  activeId: string;
  drain?: () => Promise<PendingPromptResult | null>;
  tick: number;
  open(id: string): Promise<void>;
  receive(payload: PendingPromptResult): Promise<void>;
  onError(error: unknown): void;
}) {
  const inbox = inboxFor(drain);
  const queue = useSyncExternalStore(inbox.subscribe, inbox.read, inbox.read);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const opening = useRef<PendingPromptResult | null>(null);
  const delivering = useRef<PendingPromptResult | null>(null);
  const latest = useRef({ open, receive, onError });
  latest.current = { open, receive, onError };
  useEffect(() => {
    if (!drain) return;
    // The destructive drain must finish even if activeId changes meanwhile.
    inbox.draining = inbox.draining.then(async () => {
      const payload = await drain();
      if (payload) inbox.update(rows => [...rows, payload]);
    }).catch(error => latest.current.onError(error));
  }, [activeId, drain, tick, inbox]);
  useEffect(() => {
    const payload = queue[0];
    if (!payload || delivering.current === payload) return;
    if (payload.sessionId && payload.sessionId !== activeId) {
      if (opening.current === payload) return;
      opening.current = payload;
      void waitForHomeDraftHandoff(payload.sessionId).then(() => latest.current.open(payload.sessionId!)).catch(error => {
        opening.current = null;
        latest.current.onError(error);
        // Keep the payload for a later navigation/retry, never send it elsewhere.
      });
      return;
    }
    opening.current = null;
    delivering.current = payload;
    // Let session-switch effects clear outgoing attachments before delivery.
    void Promise.resolve().then(async () => {
      if (!alive.current) return false;
      await latest.current.receive(payload);
      return true;
    }).then(delivered => {
      if (!delivered) return;
      inbox.update(rows => rows.filter(row => row !== payload));
    }).catch(error => latest.current.onError(error)).finally(() => {
      delivering.current = null;
    });
  }, [activeId, queue, tick, inbox]);
}
