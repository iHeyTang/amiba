import { useCallback, useEffect, useRef, useState } from "react";

/** One-shot handoff into a contributed trajectory view, scoped to this visit. */
export function useTrajectoryInspection(sessionId: string | null | undefined, entries: readonly { id: string }[]) {
  const available = entries.some(entry => entry.id === "trajectory");
  const visit = useRef({ sessionId, available, epoch: 0 });
  if (visit.current.sessionId !== sessionId || visit.current.available !== available) {
    visit.current = { sessionId, available, epoch: visit.current.epoch + 1 };
  }
  const epoch = visit.current.epoch;
  const [selection, setSelection] = useState<{ sessionId: string; id: string } | null>(null);
  const [request, setRequest] = useState<{ epoch: number; callId: string } | null>(null);
  const current = selection && selection.sessionId === sessionId && entries.some(entry => entry.id === selection.id) ? selection : null;
  useEffect(() => {
    if (selection && !current) setSelection(null);
    if (request && (request.epoch !== epoch || !available)) setRequest(null);
  }, [selection, current, request, epoch, available]);
  const select = useCallback((id: string | null) => {
    if (visit.current.epoch !== epoch) return;
    setSelection(id !== null && sessionId ? { sessionId, id } : null);
    if (id !== "trajectory") setRequest(null);
  }, [sessionId, epoch]);
  const inspectCall = useCallback((callId: string) => {
    if (!sessionId || !available || visit.current.epoch !== epoch) return;
    setRequest({ epoch, callId });
    setSelection({ sessionId, id: "trajectory" });
  }, [sessionId, available, epoch]);
  const activeRequest = request?.epoch === epoch && available ? request : null;
  return {
    selection: current,
    select,
    inspectCall: available && sessionId ? inspectCall : undefined,
    owner: {
      viewRequest: activeRequest ? { view: "trajectory", focus: activeRequest.callId } : null,
      openView: (view: string, focus: string) => {
        if (!sessionId || visit.current.epoch !== epoch || !entries.some(entry => entry.id === view)) return;
        setSelection({ sessionId, id: view });
        setRequest(view === "trajectory" ? { epoch, callId: focus } : null);
      },
      completeViewRequest: () => setRequest(current => current === activeRequest ? null : current),
    },
  };
}
