import { waitForHomeDraftHandoff } from "../home/home-draft-handoff";
import { useEffect, useRef, useState } from "react";
import type { PendingPromptResult } from "./internal/capabilities";

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
  const [queue, setQueue] = useState<PendingPromptResult[]>([]);
  const draining = useRef(Promise.resolve());
  const opening = useRef<PendingPromptResult | null>(null);
  const delivering = useRef<PendingPromptResult | null>(null);
  const latest = useRef({ open, receive, onError });
  latest.current = { open, receive, onError };
  useEffect(() => {
    if (!drain) return;
    // The destructive drain must finish even if activeId changes meanwhile.
    draining.current = draining.current.then(async () => {
      const payload = await drain();
      if (payload) setQueue(rows => [...rows, payload]);
    }).catch(error => latest.current.onError(error));
  }, [activeId, drain, tick]);
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
    void Promise.resolve().then(() => latest.current.receive(payload)).then(() => {
      setQueue(rows => rows.filter(row => row !== payload));
    }).catch(error => latest.current.onError(error)).finally(() => {
      delivering.current = null;
    });
  }, [activeId, queue, tick]);
}
