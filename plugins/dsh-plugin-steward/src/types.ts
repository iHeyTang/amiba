/** Amiba steward — durable task bindings and the shapes shared by service, tools, remote and client. */

/**
 * The plugin id the host writes into a dispatched message's `source.plugin`
 * (see `service.ts`'s `STEWARD_SOURCE` re-export) and the id the client
 * registers under `amiba.message.source` (see `client/index.tsx`) so the
 * chat bubble labels those messages "来自 大管家". Kept here, not in
 * `service.ts`, because the client bundle must not import `service.ts`
 * (it pulls in Node built-ins) but does need this exact id.
 */
export const STEWARD_SOURCE = "amiba-steward";

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
  basePreset?: string;
  extensionVersion?: number;
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
