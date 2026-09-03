/** Amiba steward — durable task bindings and the shapes shared by service, tools, remote and client. */

/** The steward's own agent preset id — shared by the host seeder and the client's hidePreset call. */
export const STEWARD_PRESET_ID = "amiba-steward";

export type StewardTaskStatus = "idle" | "running" | "needs_input" | "done" | "failed";

export interface StewardTask {
  /** `task-<uuid>` */
  id: string;
  title: string;
  /** The ordinary DSH session this task lives in. */
  sessionId: string;
  cwd: string;
  origin: "created" | "adopted";
  status: StewardTaskStatus;
  /** Seq of the last `turn/end` already reported to the steward; -1 = nothing yet. */
  lastReportedSeq: number;
  /** First 200 chars of the latest assistant reply. */
  lastSummary?: string;
  /** Set while `status === "failed"`. */
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface StewardState {
  version: 1;
  stewardSessionId?: string;
  tasks: StewardTask[];
}

export const EMPTY_STEWARD_STATE: StewardState = { version: 1, tasks: [] };

export interface DispatchInput {
  taskId?: string;
  newTask?: { title: string; cwd?: string };
  message: string;
}

export interface DispatchResult {
  taskId: string;
  sessionId: string;
  created: boolean;
}

export interface AdoptInput {
  sessionId?: string;
  titleQuery?: string;
  title?: string;
}

export type AdoptResult =
  | { kind: "adopted"; task: StewardTask; existing: boolean }
  | { kind: "candidates"; candidates: Array<{ sessionId: string; title: string }> };

/** One completed turn of a task session, as read back for `steward_read_task`. */
export interface TaskTurnView {
  turn: number;
  user: string;
  assistant: string;
  endedAt: number;
  failed: boolean;
}
