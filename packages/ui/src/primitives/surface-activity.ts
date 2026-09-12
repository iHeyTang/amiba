import type { SnapshotFrame, StreamEvent } from "@amiba/app-runtime/core";
import type {
  SurfaceActivity,
  SurfaceActivitySnapshot,
} from "@amiba/extension-sdk";

/** Presentation projection only. The engine remains the authority for execution. */
export function createSurfaceActivity(sessionId: string) {
  let state: SurfaceActivitySnapshot = {
    sessionId,
    phase: "idle",
    restored: true,
    revision: 0,
  };
  let base: SurfaceActivitySnapshot["phase"] = "idle";
  const approvals = new Set<string>(),
    questions = new Set<string>(),
    tools = new Set<string>();
  const listeners = new Set<() => void>();
  const publish = (restored: boolean) => {
    const phase =
      approvals.size || questions.size
        ? "waiting"
        : tools.size
          ? "tooling"
          : base;
    if (phase === state.phase && restored === state.restored) return;
    state = { sessionId, phase, restored, revision: state.revision + 1 };
    listeners.forEach((fn) => fn());
  };
  const clear = () => {
    approvals.clear();
    questions.clear();
    tools.clear();
  };
  const activity: SurfaceActivity = {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    activity,
    snapshot(frame: SnapshotFrame) {
      if (frame.sessionId !== sessionId) return;
      clear();
      const s = frame.kind === "absent" ? frame : frame.state;
      s.pendingApprovals?.forEach((a) => approvals.add(a.approvalId));
      s.pendingQuestions?.forEach((q) => questions.add(q.requestId));
      base =
        frame.kind === "absent"
          ? "idle"
          : frame.kind === "interrupted"
            ? "interrupted"
            : frame.state.error
              ? "failed"
              : frame.kind === "completed"
                ? "completed"
                : "thinking";
      if (frame.hostRunning === true) base = "thinking";
      else if (frame.hostRunning === false && frame.kind === "live") base = "idle";
      if (frame.kind === "live" && frame.hostRunning !== false)
        frame.state.toolProgress
          .filter((t) => t.status === "running")
          .forEach((t) => tools.add(t.toolCallId));
      publish(true);
    },
    event(id: string, e: StreamEvent) {
      if (id !== sessionId) return;
      switch (e.kind) {
        case "begin":
          clear();
          base = "thinking";
          break;
        case "reasoning":
          base = "thinking";
          break;
        case "chunk":
          base = "responding";
          break;
        case "toolProgress":
          e.event.status === "running"
            ? tools.add(e.event.toolCallId)
            : tools.delete(e.event.toolCallId);
          break;
        case "approvalRequest":
          approvals.add(e.request.approvalId);
          break;
        case "approvalResolved":
          approvals.delete(e.approvalId);
          break;
        case "questionRequest":
          questions.add(e.request.requestId);
          break;
        case "questionResolved":
          questions.delete(e.requestId);
          break;
        case "done":
          clear();
          base = "completed";
          break;
        case "error":
          clear();
          base = "failed";
          break;
        case "aborted":
          clear();
          base = "interrupted";
          break;
        default:
          return;
      }
      publish(false);
    },
  };
}
