import { useCallback, useState } from "react";
import {
  postHermesApprovalDecision,
  useSessions,
  type ApprovalOutcome,
  type ApprovalRecord,
  type ChatEngineClient,
  type HermesApprovalDecision,
  type HermesApprovalRequest,
} from "@amiba/core";

import type { UiMessage } from "./types";

/**
 * Approval flow state + actions. The gateway can pause a turn mid-run
 * and emit an `approval.requested` event when it wants the user to
 * confirm a sensitive tool call. The panel surfaces a banner above the
 * composer; the user picks an option and we POST the decision back
 * (with an optimistic local clear so the banner doesn't lag).
 *
 * Per-message approval *records* live on the assistant bubble (in
 * `m.hermesApprovalRecords`) so the history still shows "I was asked
 * to X, decided Y" long after the banner is gone.
 *
 * Coupling note: `appendApprovalRecord` needs to know which assistant
 * message is currently streaming (so it can attach the record there)
 * and needs to push a timeline marker. Both are owned by the streaming
 * subsystem — we receive them as callbacks.
 */
export interface UseApprovalsArgs {
  client: ChatEngineClient;
  sessions: ReturnType<typeof useSessions>;
  /** Returns the uiId of the assistant message that's currently
   * streaming, or `undefined` if no stream is in flight. The hook
   * skips approval-record attachment when this returns undefined —
   * the gateway shouldn't fire an approval outside a turn, but we
   * don't want to crash if it does. */
  getCurrentAssistantUiId: () => string | undefined;
  /** Push an approval marker into the verbose timeline so the chip
   * renders inline between text / tool items. Idempotent on the
   * stream-side. */
  appendApprovalToTimeline: (approvalId: string) => void;
  /** Schedule a flush of the verbose state so the timeline marker
   * actually reaches the bubble on the next animation frame. */
  scheduleVerboseFlush: () => void;
}

export interface UseApprovalsResult {
  pendingApprovals: HermesApprovalRequest[];
  setPendingApprovals: React.Dispatch<
    React.SetStateAction<HermesApprovalRequest[]>
  >;
  approvalInFlight: Record<string, HermesApprovalDecision>;
  approvalError: string | null;
  setApprovalError: (v: string | null) => void;
  activeRunId: string | null;
  setActiveRunId: React.Dispatch<React.SetStateAction<string | null>>;
  /** Append (or refresh) the persistent approval record on whichever
   * assistant message is currently streaming. Idempotent on
   * `approvalId`. */
  appendApprovalRecord: (
    req: HermesApprovalRequest,
    requestedAt: number,
  ) => void;
  /** Stamp the final outcome on a persisted record. */
  markApprovalOutcome: (
    approvalId: string,
    outcome: ApprovalOutcome,
    decidedAt: number,
  ) => void;
  /** POST a decision for one pending approval; optimistically clear
   * the local card. */
  respondToApproval: (
    request: HermesApprovalRequest,
    decision: HermesApprovalDecision,
  ) => Promise<void>;
  /** Stream-event router entry: handle an "approvalRequest" event by
   * adding/refreshing the banner row AND the persistent record. */
  onApprovalRequestEvent: (req: HermesApprovalRequest) => void;
  /** Stream-event router entry: handle an "approvalResolved" event by
   * dropping the banner row and any in-flight marker. */
  onApprovalResolvedEvent: (approvalId: string) => void;
  /** Drop all approval state — used on session switch, new-chat, and
   * snapshot replay. */
  reset: () => void;
}

export function useApprovals(args: UseApprovalsArgs): UseApprovalsResult {
  const {
    client,
    sessions,
    getCurrentAssistantUiId,
    appendApprovalToTimeline,
    scheduleVerboseFlush,
  } = args;

  const [pendingApprovals, setPendingApprovals] = useState<
    HermesApprovalRequest[]
  >([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [approvalInFlight, setApprovalInFlight] = useState<
    Record<string, HermesApprovalDecision>
  >({});
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const appendApprovalRecord = useCallback(
    (req: HermesApprovalRequest, requestedAt: number): void => {
      const uiId = getCurrentAssistantUiId();
      if (!uiId) return;
      const record: ApprovalRecord = {
        approvalId: req.approvalId,
        command: req.command,
        tool: req.tool,
        description: req.description,
        reason: req.reason,
        requestedAt,
      };
      appendApprovalToTimeline(req.approvalId);
      scheduleVerboseFlush();
      sessions.setActiveMessages((prev) =>
        (prev as UiMessage[]).map((m) => {
          if (m.uiId !== uiId) return m;
          const existing = m.hermesApprovalRecords ?? [];
          const without = existing.filter(
            (r) => r.approvalId !== req.approvalId,
          );
          return {
            ...m,
            hermesApprovalRecords: [...without, record],
          };
        }),
      );
    },
    [
      sessions,
      getCurrentAssistantUiId,
      appendApprovalToTimeline,
      scheduleVerboseFlush,
    ],
  );

  const markApprovalOutcome = useCallback(
    (
      approvalId: string,
      outcome: ApprovalOutcome,
      decidedAt: number,
    ): void => {
      if (!approvalId) return;
      sessions.setActiveMessages((prev) =>
        (prev as UiMessage[]).map((m) => {
          const records = m.hermesApprovalRecords;
          if (!records || records.length === 0) return m;
          const i = records.findIndex((r) => r.approvalId === approvalId);
          if (i < 0) return m;
          // No-op when already settled — don't trample a real outcome
          // with a follow-up `expired`/`failed`.
          if (records[i].outcome) return m;
          const next = records.slice();
          next[i] = { ...next[i], outcome, decidedAt };
          return { ...m, hermesApprovalRecords: next };
        }),
      );
    },
    [sessions],
  );

  const respondToApproval = useCallback(
    async (
      request: HermesApprovalRequest,
      decision: HermesApprovalDecision,
    ): Promise<void> => {
      setApprovalError(null);
      const runId = request.runId || activeRunId || "";
      if (!runId) {
        setApprovalError(
          "Missing run id for this approval. The gateway didn't return X-Hermes-Run-Id and the event payload didn't include one.",
        );
        return;
      }
      setApprovalInFlight((prev) => ({
        ...prev,
        [request.approvalId]: decision,
      }));
      const res = await postHermesApprovalDecision({
        runId,
        approvalId: request.approvalId,
        decision,
        profileId: request.profileId,
      });
      if (!res.ok) {
        // 409 `approval_not_active` means the gateway has already timed
        // out and cleaned up this approval session (default
        // approvals.gateway_timeout = 300s). The agent has been
        // unblocked with a BLOCKED response, the run has typically
        // finished, and there's nothing left to approve. Treat it as
        // "card is stale" — drop it locally + show a friendly notice
        // instead of leaving the user clicking a button that will
        // never succeed.
        const errStr = res.error || "";
        const isStale =
          res.status === 409 ||
          errStr.includes("approval_not_active") ||
          errStr.includes("no active approval session") ||
          errStr.includes("no pending approval");
        if (isStale) {
          setPendingApprovals((prev) =>
            prev.filter((a) => a.approvalId !== request.approvalId),
          );
          setApprovalInFlight((prev) => {
            const next = { ...prev };
            delete next[request.approvalId];
            return next;
          });
          // Sync the engine so its runtime state also drops the stale
          // pending, matching the optimistic-clear behaviour on a
          // successful POST.
          const sid = sessions.activeId;
          if (sid) {
            try {
              client.clearApproval(sid, request.approvalId);
            } catch {
              // Best-effort.
            }
          }
          // Stamp the persisted record so the history chip flips to
          // "Expired" instead of staying in a perpetual pending state.
          markApprovalOutcome(request.approvalId, "expired", Date.now());
          setApprovalError(
            "Approval timed out (default 5 minutes); the command was auto-denied. To extend the window, add `gateway_timeout: 600` under the `approvals` section of ~/.hermes/config.yaml.",
          );
          return;
        }
        // POST failed for a non-stale reason (network down, gateway
        // error, bad auth). Mark the record as `failed` so it doesn't
        // stay "Waiting…" forever in the history view.
        markApprovalOutcome(request.approvalId, "failed", Date.now());
        setApprovalError(
          `Approval failed: ${res.error || "unknown"} (HTTP ${res.status ?? "?"})`,
        );
        setApprovalInFlight((prev) => {
          const next = { ...prev };
          delete next[request.approvalId];
          return next;
        });
        return;
      }
      // Optimistic clear: drop the card locally and tell the SW to do
      // the same in its runtime state. The gateway's eventual
      // `approval.responded` SSE event becomes a no-op (already
      // cleared).
      setPendingApprovals((prev) =>
        prev.filter((a) => a.approvalId !== request.approvalId),
      );
      setApprovalInFlight((prev) => {
        const next = { ...prev };
        delete next[request.approvalId];
        return next;
      });
      markApprovalOutcome(request.approvalId, decision, Date.now());
      const sid = sessions.activeId;
      if (sid) {
        try {
          client.clearApproval(sid, request.approvalId);
        } catch (e) {
          console.warn("[sidepanel] clearApproval failed:", e);
        }
      }
    },
    [client, sessions, activeRunId, markApprovalOutcome],
  );

  const onApprovalRequestEvent = useCallback(
    (req: HermesApprovalRequest): void => {
      setPendingApprovals((prev) => {
        const without = prev.filter((a) => a.approvalId !== req.approvalId);
        return [...without, req];
      });
      // Persist a pending record onto the assistant message so the
      // user can still see "I was asked to approve X" long after the
      // banner closes. The `raw.timestamp` field is Python time.time()
      // in seconds (see gateway/platforms/api_server.py:2933) —
      // multiply to ms.
      const tsField = (req.raw as Record<string, unknown> | undefined)
        ?.timestamp;
      const requestedAt =
        typeof tsField === "number" ? tsField * 1000 : Date.now();
      appendApprovalRecord(req, requestedAt);
      // Clear any leftover in-flight marker for a re-emitted request.
      setApprovalInFlight((prev) => {
        if (!(req.approvalId in prev)) return prev;
        const next = { ...prev };
        delete next[req.approvalId];
        return next;
      });
    },
    [appendApprovalRecord],
  );

  const onApprovalResolvedEvent = useCallback((approvalId: string): void => {
    setPendingApprovals((prev) =>
      prev.filter((a) => a.approvalId !== approvalId),
    );
    setApprovalInFlight((prev) => {
      if (!(approvalId in prev)) return prev;
      const next = { ...prev };
      delete next[approvalId];
      return next;
    });
  }, []);

  const reset = useCallback((): void => {
    setPendingApprovals([]);
    setActiveRunId(null);
    setApprovalInFlight({});
    setApprovalError(null);
  }, []);

  return {
    pendingApprovals,
    setPendingApprovals,
    approvalInFlight,
    approvalError,
    setApprovalError,
    activeRunId,
    setActiveRunId,
    appendApprovalRecord,
    markApprovalOutcome,
    respondToApproval,
    onApprovalRequestEvent,
    onApprovalResolvedEvent,
    reset,
  };
}
