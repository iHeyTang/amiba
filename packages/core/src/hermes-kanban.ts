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
  latest_summary: string | null;
  parents: string[];
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
