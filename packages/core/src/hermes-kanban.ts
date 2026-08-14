import { backplaneFetch } from "./backplane-client";

export type HermesKanbanStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

export interface HermesKanbanBoard {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  default_workdir: string | null;
  created_at: number | null;
  archived: boolean;
  counts: Record<string, number>;
  total: number;
  is_current: boolean;
}

export interface HermesKanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: HermesKanbanStatus;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  workspace_kind: "scratch" | "worktree" | "dir";
  workspace_path: string | null;
  branch_name: string | null;
  project_id: string | null;
  result: string | null;
  skills: string[];
  model_override: string | null;
  provider_override: string | null;
  session_id: string | null;
  block_kind: string | null;
  consecutive_failures?: number;
  last_failure_error?: string | null;
  max_runtime_seconds?: number | null;
  worker_pid?: number | null;
  current_run_id?: number | null;
  last_heartbeat_at?: number | null;
  latest_summary: string | null;
  parents: string[];
  children: string[];
}

export interface HermesKanbanComment {
  id: number;
  task_id: string;
  author: string;
  body: string;
  created_at: number;
}

export interface HermesKanbanAttachment {
  id: number;
  task_id: string;
  filename: string;
  content_type: string | null;
  size: number;
  uploaded_by: string | null;
  created_at: number;
}

export interface HermesKanbanRun {
  id: number;
  task_id: string;
  profile: string | null;
  step_key: string | null;
  status: string;
  worker_pid: number | null;
  max_runtime_seconds: number | null;
  last_heartbeat_at: number | null;
  started_at: number;
  ended_at: number | null;
  outcome: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
}

export interface HermesKanbanEvent {
  id: number;
  task_id: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: number;
  run_id: number | null;
}

export interface HermesKanbanTaskDetailResponse {
  ok: boolean;
  board: string;
  task?: HermesKanbanTask;
  comments: HermesKanbanComment[];
  attachments: HermesKanbanAttachment[];
  runs: HermesKanbanRun[];
  events: HermesKanbanEvent[];
  error?: string;
}

export interface HermesKanbanBoardsResponse {
  ok: boolean;
  boards: HermesKanbanBoard[];
  current: string;
  error?: string;
}

export interface HermesKanbanTasksResponse {
  ok: boolean;
  board: string;
  tasks: HermesKanbanTask[];
  counts: Record<string, number>;
  error?: string;
}

function taskPath(taskId: string, board?: string): string {
  const query = board ? `?board=${encodeURIComponent(board)}` : "";
  return `/hermes/kanban/tasks/${encodeURIComponent(taskId)}${query}`;
}

async function detailResult(
  response: Response,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  if (!response.ok) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: await errorText(response),
    };
  }
  return (await response.json()) as HermesKanbanTaskDetailResponse;
}

async function errorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof body?.error === "string"
    ? body.error
    : `HTTP ${response.status}`;
}

export async function getHermesKanbanBoards(): Promise<HermesKanbanBoardsResponse> {
  try {
    const response = await backplaneFetch("/hermes/kanban/boards");
    if (!response.ok) {
      return {
        ok: false,
        boards: [],
        current: "default",
        error: await errorText(response),
      };
    }
    return (await response.json()) as HermesKanbanBoardsResponse;
  } catch (error) {
    return {
      ok: false,
      boards: [],
      current: "default",
      error: String((error as Error)?.message || error),
    };
  }
}

export async function getHermesKanbanTasks(
  input: {
    board?: string;
    sessionId?: string;
    includeArchived?: boolean;
  } = {},
): Promise<HermesKanbanTasksResponse> {
  const query = new URLSearchParams();
  if (input.board) query.set("board", input.board);
  if (input.sessionId) query.set("session_id", input.sessionId);
  if (input.includeArchived) query.set("include_archived", "1");
  try {
    const response = await backplaneFetch(
      `/hermes/kanban/tasks?${query.toString()}`,
    );
    if (!response.ok) {
      return {
        ok: false,
        board: input.board || "",
        tasks: [],
        counts: {},
        error: await errorText(response),
      };
    }
    return (await response.json()) as HermesKanbanTasksResponse;
  } catch (error) {
    return {
      ok: false,
      board: input.board || "",
      tasks: [],
      counts: {},
      error: String((error as Error)?.message || error),
    };
  }
}

export async function createHermesKanbanTask(
  input: {
    title: string;
    body?: string;
    assignee?: string;
    workspace_path?: string;
    priority?: number;
    triage?: boolean;
    session_id?: string;
    parents?: string[];
    skills?: string[];
    model_override?: string;
    provider_override?: string;
    orchestration?: boolean;
  },
  board = "default",
): Promise<{ ok: boolean; task?: HermesKanbanTask; error?: string }> {
  try {
    const query = board ? `?board=${encodeURIComponent(board)}` : "";
    const response = await backplaneFetch(`/hermes/kanban/tasks${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return { ok: false, error: await errorText(response) };
    return (await response.json()) as {
      ok: boolean;
      task: HermesKanbanTask;
    };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
    };
  }
}

export async function getHermesKanbanTask(
  taskId: string,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(taskPath(taskId, board)),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function updateHermesKanbanTask(
  taskId: string,
  input: {
    title?: string;
    body?: string;
    assignee?: string | null;
    priority?: number;
    workspace_path?: string;
    reclaim_running?: boolean;
  },
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(taskPath(taskId, board), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function runHermesKanbanTaskAction(
  taskId: string,
  input: {
    action:
      | "block"
      | "unblock"
      | "retry"
      | "complete"
      | "request_review"
      | "request_changes"
      | "move"
      | "archive";
    reason?: string;
    kind?: string;
    summary?: string;
    result?: string;
    reviewer?: string;
    assignee?: string;
    status?: HermesKanbanStatus;
    force?: boolean;
  },
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(taskChildPath(taskId, "actions", board), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

function taskChildPath(taskId: string, child: string, board?: string): string {
  return `/hermes/kanban/tasks/${encodeURIComponent(taskId)}/${child}${
    board ? `?board=${encodeURIComponent(board)}` : ""
  }`;
}

export async function addHermesKanbanComment(
  taskId: string,
  body: string,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(taskChildPath(taskId, "comments", board), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, author: "amiba" }),
      }),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function addHermesKanbanDependency(
  taskId: string,
  parentId: string,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(taskChildPath(taskId, "dependencies", board), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: parentId }),
      }),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function removeHermesKanbanDependency(
  taskId: string,
  parentId: string,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(
        `/hermes/kanban/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(parentId)}${
          board ? `?board=${encodeURIComponent(board)}` : ""
        }`,
        { method: "DELETE" },
      ),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function uploadHermesKanbanAttachment(
  taskId: string,
  file: File,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    const form = new FormData();
    form.append("file", file);
    return await detailResult(
      await backplaneFetch(taskChildPath(taskId, "attachments", board), {
        method: "POST",
        body: form,
      }),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function downloadHermesKanbanAttachment(
  taskId: string,
  attachmentId: number,
  board?: string,
): Promise<{ ok: boolean; blob?: Blob; filename?: string; error?: string }> {
  try {
    const response = await backplaneFetch(
      `/hermes/kanban/tasks/${encodeURIComponent(taskId)}/attachments/${attachmentId}${
        board ? `?board=${encodeURIComponent(board)}` : ""
      }`,
    );
    if (!response.ok) return { ok: false, error: await errorText(response) };
    const disposition = response.headers.get("Content-Disposition") || "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    return {
      ok: true,
      blob: await response.blob(),
      filename: encoded ? decodeURIComponent(encoded) : undefined,
    };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export async function deleteHermesKanbanAttachment(
  taskId: string,
  attachmentId: number,
  board?: string,
): Promise<HermesKanbanTaskDetailResponse> {
  try {
    return await detailResult(
      await backplaneFetch(
        `/hermes/kanban/tasks/${encodeURIComponent(taskId)}/attachments/${attachmentId}${
          board ? `?board=${encodeURIComponent(board)}` : ""
        }`,
        { method: "DELETE" },
      ),
      board,
    );
  } catch (error) {
    return {
      ok: false,
      board: board || "",
      comments: [],
      attachments: [],
      runs: [],
      events: [],
      error: String((error as Error)?.message || error),
    };
  }
}

export async function deleteHermesKanbanTask(
  taskId: string,
  board?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await backplaneFetch(taskPath(taskId, board), {
      method: "DELETE",
    });
    return response.ok
      ? { ok: true }
      : { ok: false, error: await errorText(response) };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}
