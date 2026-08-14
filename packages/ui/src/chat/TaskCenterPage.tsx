import {
  Activity,
  AlertCircle,
  Archive,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  Download,
  FileText,
  Fingerprint,
  FolderOpen,
  GitBranch,
  Link2,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import {
  addHermesKanbanComment,
  addHermesKanbanDependency,
  createHermesKanbanTask,
  deleteHermesKanbanAttachment,
  deleteHermesKanbanTask,
  downloadHermesKanbanAttachment,
  getHermesKanbanBoards,
  getHermesKanbanTask,
  getHermesKanbanTasks,
  getHermesProfiles,
  removeHermesKanbanDependency,
  runHermesKanbanTaskAction,
  updateHermesKanbanTask,
  uploadHermesKanbanAttachment,
  type HermesKanbanBoard,
  type HermesKanbanStatus,
  type HermesKanbanTask,
  type HermesKanbanTaskDetailResponse,
  type HermesProfile,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { getPlatform } from "@amiba/platform";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from "../primitives";
import { SidebarExpandControl } from "../navigation/SidebarExpandControl";
import { KanbanStatusBadge } from "./KanbanStatusBadge";

const AUTO_REFRESH_MS = 5_000;
const UNASSIGNED = "__unassigned__";

const BOARD_GROUPS: Array<{
  key: string;
  statuses: HermesKanbanStatus[];
  icon: typeof CircleDot;
  dropStatus?: HermesKanbanStatus;
}> = [
  {
    key: "planning",
    statuses: ["triage", "todo", "scheduled"],
    icon: Clock3,
    dropStatus: "todo",
  },
  {
    key: "ready",
    statuses: ["ready"],
    icon: CircleDot,
    dropStatus: "ready",
  },
  { key: "running", statuses: ["running"], icon: Bot },
  {
    key: "attention",
    statuses: ["blocked", "review"],
    icon: AlertCircle,
    dropStatus: "blocked",
  },
  {
    key: "done",
    statuses: ["done"],
    icon: CheckCircle2,
    dropStatus: "done",
  },
];

const MOVABLE_STATUSES: HermesKanbanStatus[] = [
  "triage",
  "todo",
  "ready",
  "blocked",
  "review",
  "done",
];

interface TaskFormState {
  title: string;
  body: string;
  assignee: string;
  workdir: string;
  priority: number;
  parentId?: string;
}

function emptyTaskForm(assignee: string): TaskFormState {
  return {
    title: "",
    body: "",
    assignee: assignee || UNASSIGNED,
    workdir: "",
    priority: 0,
  };
}

function formatTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp * 1_000);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function TaskCard({
  task,
  selected,
  onClick,
}: {
  task: HermesKanbanTask;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useT();
  const hasChildren = task.children.length > 0;
  return (
    <button
      type="button"
      draggable={task.status !== "running"}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      }}
      onClick={onClick}
      className={cn(
        "w-full rounded-xl border bg-background px-3 py-2.5 text-left shadow-sm transition-colors hover:border-border hover:bg-accent/30",
        selected
          ? "border-foreground/25 ring-1 ring-foreground/10"
          : "border-border/55",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-5">
          {task.title}
        </h3>
        {task.priority > 0 ? (
          <span className="shrink-0 text-[10px] font-medium text-amber-600">
            P{task.priority}
          </span>
        ) : null}
      </div>
      {task.latest_summary ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {task.latest_summary}
        </p>
      ) : null}
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <KanbanStatusBadge status={task.status} />
        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
          <Fingerprint className="h-3 w-3 shrink-0" />
          {task.assignee || t("tasks.assignee.shortUnassigned")}
        </span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {hasChildren ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={t("tasks.card.childCount", {
                count: task.children.length,
              })}
            >
              <GitBranch className="h-3 w-3" />
              {task.children.length}
            </span>
          ) : null}
          {task.parents.length > 0 ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={t("tasks.dependencies")}
            >
              <Link2 className="h-3 w-3" />
              {task.parents.length}
            </span>
          ) : null}
        </span>
      </div>
    </button>
  );
}

function TaskColumn({
  groupKey,
  Icon,
  tasks,
  selectedId,
  dropStatus,
  onOpen,
  onMove,
}: {
  groupKey: string;
  Icon: typeof CircleDot;
  tasks: HermesKanbanTask[];
  selectedId: string | null;
  dropStatus?: HermesKanbanStatus;
  onOpen: (task: HermesKanbanTask) => void;
  onMove: (taskId: string, status: HermesKanbanStatus) => void;
}) {
  const { t } = useT();
  const [dragOver, setDragOver] = useState(false);
  return (
    <section
      onDragOver={(event) => {
        if (!dropStatus) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const taskId = event.dataTransfer.getData("text/plain");
        if (taskId && dropStatus) onMove(taskId, dropStatus);
      }}
      className={cn(
        "flex min-h-0 min-w-0 flex-col rounded-2xl border border-transparent bg-muted/30 transition-colors",
        dragOver && "border-foreground/15 bg-muted/55",
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h2 className="text-xs font-semibold">
          {t(`tasks.column.${groupKey}` as never)}
        </h2>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {tasks.length}
        </span>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 px-2 pb-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={selectedId === task.id}
              onClick={() => onOpen(task)}
            />
          ))}
          {tasks.length === 0 ? (
            <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground/60">
              {t("tasks.column.empty")}
            </div>
          ) : null}
        </div>
      </ScrollArea>
    </section>
  );
}

export interface TaskCenterPageProps {
  topBarHeightPx?: number;
  topBarClassName?: string;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  onExpandSidebar?: () => void;
}

export function TaskCenterPage({
  topBarHeightPx = 40,
  topBarClassName,
  topBarLeftInset = 0,
  sidebarCollapsed = false,
  showSidebarExpandControl = sidebarCollapsed,
  onExpandSidebar,
}: TaskCenterPageProps = {}) {
  const { t } = useT();
  const [boards, setBoards] = useState<HermesKanbanBoard[]>([]);
  const [board, setBoard] = useState("default");
  const [tasks, setTasks] = useState<HermesKanbanTask[]>([]);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState("default");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<HermesKanbanTaskDetailResponse | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(() =>
    emptyTaskForm(UNASSIGNED),
  );
  const [creating, setCreating] = useState(false);
  const chooseDirectory = getPlatform().workspaces?.chooseDirectory;

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const loadBoards = useCallback(async () => {
    const result = await getHermesKanbanBoards();
    if (!result.ok) {
      setError(result.error || t("tasks.loadFailed"));
      return;
    }
    setBoards(result.boards);
    setBoard((value) =>
      result.boards.some((item) => item.slug === value)
        ? value
        : result.current || "default",
    );
  }, [t]);

  const loadTasks = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      const result = await getHermesKanbanTasks({ board });
      if (silent) setRefreshing(false);
      else setLoading(false);
      if (!result.ok) {
        setError(result.error || t("tasks.loadFailed"));
        return;
      }
      setError(null);
      setTasks(result.tasks);
      if (
        selectedIdRef.current &&
        !result.tasks.some((task) => task.id === selectedIdRef.current)
      ) {
        setSelectedId(null);
        setDetail(null);
      }
    },
    [board, t],
  );

  const loadDetail = useCallback(
    async (taskId: string, silent = false) => {
      if (!silent) setDetailLoading(true);
      const result = await getHermesKanbanTask(taskId, board);
      if (!silent) setDetailLoading(false);
      if (selectedIdRef.current !== taskId) return;
      if (!result.ok || !result.task) {
        setError(result.error || t("tasks.detail.loadFailed"));
        return;
      }
      setDetail(result);
      setTasks((previous) =>
        previous.map((task) =>
          task.id === result.task!.id ? result.task! : task,
        ),
      );
    },
    [board, t],
  );

  useEffect(() => {
    void loadBoards();
    void getHermesProfiles().then((result) => {
      if (!result.ok) return;
      setProfiles(result.profiles);
      setActiveProfile(result.active);
      setForm((value) => ({
        ...value,
        assignee:
          value.assignee === UNASSIGNED ? result.active : value.assignee,
      }));
    });
  }, [loadBoards]);

  useEffect(() => {
    setSelectedId(null);
    setDetail(null);
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadTasks(true);
      const taskId = selectedIdRef.current;
      if (taskId) void loadDetail(taskId, true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadDetail, loadTasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((task) =>
      [task.id, task.title, task.body, task.assignee, task.latest_summary]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, tasks]);

  const openTask = useCallback(
    (task: HermesKanbanTask) => {
      selectedIdRef.current = task.id;
      setSelectedId(task.id);
      setDetail({
        ok: true,
        board,
        task,
        comments: [],
        attachments: [],
        runs: [],
        events: [],
      });
      void loadDetail(task.id);
    },
    [board, loadDetail],
  );

  const openCreateDialog = useCallback(
    (parentId: string) => {
      setForm({ ...emptyTaskForm(activeProfile), parentId });
      setCreateOpen(true);
      const workspaces = getPlatform().workspaces;
      if (!workspaces) return;
      void workspaces.getDefaultRoot().then((root) => {
        setForm((value) => ({ ...value, workdir: value.workdir || root }));
      });
    },
    [activeProfile],
  );

  async function createTask() {
    if (!form.parentId || !form.title.trim()) return;
    setCreating(true);
    const result = await createHermesKanbanTask(
      {
        title: form.title.trim(),
        body: form.body.trim() || undefined,
        assignee: form.assignee === UNASSIGNED ? undefined : form.assignee,
        workspace_path: form.workdir.trim() || undefined,
        priority: form.priority,
        parents: [form.parentId],
      },
      board,
    );
    setCreating(false);
    if (!result.ok) {
      setError(result.error || t("tasks.createFailed"));
      return;
    }
    setCreateOpen(false);
    await Promise.all([loadTasks(true), loadBoards()]);
    if (result.task) openTask(result.task);
  }

  async function moveTask(taskId: string, status: HermesKanbanStatus) {
    const current = tasks.find((task) => task.id === taskId);
    if (!current || current.status === status || current.status === "running")
      return;
    const result = await runHermesKanbanTaskAction(
      taskId,
      { action: "move", status },
      board,
    );
    if (!result.ok) {
      setError(result.error || t("tasks.actionFailed"));
      return;
    }
    if (selectedIdRef.current === taskId) setDetail(result);
    await loadTasks(true);
  }

  async function acceptDetailResult(
    result: HermesKanbanTaskDetailResponse,
  ): Promise<boolean> {
    if (!result.ok || !result.task) {
      setError(result.error || t("tasks.actionFailed"));
      return false;
    }
    setError(null);
    setDetail(result);
    await loadTasks(true);
    return true;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header
        data-testid="task-board-header"
        className={cn(
          "flex shrink-0 items-center gap-2 bg-background pr-2",
          topBarClassName,
        )}
        style={{
          height: topBarHeightPx,
          paddingLeft: sidebarCollapsed ? Math.max(topBarLeftInset, 12) : 14,
        }}
      >
        {onExpandSidebar ? (
          <SidebarExpandControl
            className="mr-1"
            collapsed={sidebarCollapsed}
            onExpand={onExpandSidebar}
            visible={showSidebarExpandControl}
          />
        ) : null}
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="shrink-0 text-sm font-medium tracking-tight">
            {t("tasks.title")}
          </h1>
          <span className="hidden truncate text-[11px] text-muted-foreground xl:block">
            {t("tasks.board.description")}
          </span>
        </div>
        {boards.length > 1 ? (
          <div className="app-no-drag flex min-w-0 items-center">
            <Select value={board} onValueChange={setBoard}>
              <SelectTrigger className="h-7 w-auto min-w-36 max-w-48 border-0 bg-muted/60 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {boards.map((item) => (
                  <SelectItem key={item.slug} value={item.slug}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="app-no-drag ml-auto flex min-w-0 items-center gap-1">
          <div className="relative w-40 lg:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-7 rounded-full pl-8 text-xs"
              placeholder={t("tasks.search")}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            aria-label={t("common.refresh")}
            onClick={() =>
              void Promise.all([
                loadTasks(true),
                loadBoards(),
                selectedIdRef.current
                  ? loadDetail(selectedIdRef.current, true)
                  : Promise.resolve(),
              ])
            }
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? (
            <div className="mx-4 mb-2 mt-1 flex items-center gap-2 rounded-lg bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setError(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-x-auto px-4 pb-4">
            {loading && tasks.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div
                data-testid="task-board-lanes"
                className="grid h-full w-full grid-cols-[repeat(5,minmax(16rem,1fr))] gap-3"
              >
                {BOARD_GROUPS.map(({ key, statuses, icon, dropStatus }) => (
                  <TaskColumn
                    key={key}
                    groupKey={key}
                    Icon={icon}
                    tasks={filtered.filter((task) =>
                      statuses.includes(task.status),
                    )}
                    selectedId={selectedId}
                    dropStatus={dropStatus}
                    onOpen={openTask}
                    onMove={(taskId, status) => void moveTask(taskId, status)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {selectedId ? (
          <TaskInspector
            detail={detail}
            loading={detailLoading}
            tasks={tasks}
            profiles={profiles}
            board={board}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
            onOpenTask={(taskId) => {
              const task = tasks.find((item) => item.id === taskId);
              if (task) openTask(task);
            }}
            onCreateSubtask={(parentId) => openCreateDialog(parentId)}
            onResult={(result) => acceptDetailResult(result)}
            onError={(message) => setError(message)}
            onDeleted={async () => {
              setSelectedId(null);
              setDetail(null);
              await Promise.all([loadTasks(true), loadBoards()]);
            }}
          />
        ) : null}
      </div>

      {form.parentId ? (
        <TaskFormDialog
          open={createOpen}
          title={t("tasks.subtask.create")}
          form={form}
          profiles={profiles}
          chooseDirectory={chooseDirectory}
          busy={creating}
          submitLabel={t("common.add")}
          onOpenChange={setCreateOpen}
          onChange={setForm}
          onSubmit={() => void createTask()}
        />
      ) : null}
    </div>
  );
}

function TaskInspector({
  detail,
  loading,
  tasks,
  profiles,
  board,
  onClose,
  onOpenTask,
  onCreateSubtask,
  onResult,
  onError,
  onDeleted,
}: {
  detail: HermesKanbanTaskDetailResponse | null;
  loading: boolean;
  tasks: HermesKanbanTask[];
  profiles: HermesProfile[];
  board: string;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onCreateSubtask: (parentId: string) => void;
  onResult: (result: HermesKanbanTaskDetailResponse) => Promise<boolean>;
  onError: (message: string) => void;
  onDeleted: () => Promise<void>;
}) {
  const { t } = useT();
  const task = detail?.task as HermesKanbanTask;
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<TaskFormState>(() =>
    emptyTaskForm(UNASSIGNED),
  );
  const [comment, setComment] = useState("");
  const [dependency, setDependency] = useState("");
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [actionKind, setActionKind] = useState<
    "block" | "complete" | "review" | "changes" | null
  >(null);
  const [actionText, setActionText] = useState("");
  const [actionAssignee, setActionAssignee] = useState(UNASSIGNED);
  const [blockKind, setBlockKind] = useState("needs_input");

  useEffect(() => {
    if (!task) return;
    setEditForm({
      title: task.title,
      body: task.body || "",
      assignee: task.assignee || UNASSIGNED,
      workdir: task.workspace_path || "",
      priority: task.priority,
    });
  }, [task]);

  const taskById = useMemo(
    () => new Map(tasks.map((item) => [item.id, item])),
    [tasks],
  );
  const dependencyOptions = tasks.filter(
    (item) =>
      item.id !== task?.id &&
      !task?.parents.includes(item.id) &&
      item.status !== "archived",
  );

  if (!task) {
    return (
      <aside className="flex w-[400px] shrink-0 items-center justify-center border-l border-border/45 bg-background">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </aside>
    );
  }

  const hasChildren = task.children.length > 0;
  const completedChildren = hasChildren
    ? task.children.filter((taskId) => {
        const status = taskById.get(taskId)?.status;
        return status === "done" || status === "archived";
      }).length
    : 0;
  const nextHandler = hasChildren
    ? t("tasks.orchestration.progress", {
        completed: completedChildren,
        total: task.children.length,
      })
    : task.status === "blocked"
      ? t("tasks.next.human")
      : task.status === "review"
        ? t("tasks.next.reviewer", {
            name: task.assignee || t("tasks.assignee.shortUnassigned"),
          })
        : task.status === "running"
          ? t("tasks.next.running", {
              name: task.assignee || t("tasks.assignee.shortUnassigned"),
            })
          : task.status === "done"
            ? t("tasks.next.done")
            : task.assignee
              ? t("tasks.next.agent", { name: task.assignee })
              : t("tasks.next.unassigned");

  async function perform(
    operation: () => Promise<HermesKanbanTaskDetailResponse>,
  ) {
    setBusy(true);
    const result = await operation();
    const ok = await onResult(result);
    setBusy(false);
    return ok;
  }

  function openAction(kind: typeof actionKind) {
    setActionKind(kind);
    setActionText("");
    setActionAssignee(task.assignee || UNASSIGNED);
    setBlockKind("needs_input");
  }

  async function submitAction() {
    if (!actionKind) return;
    let result: boolean;
    if (actionKind === "block") {
      result = await perform(() =>
        runHermesKanbanTaskAction(
          task.id,
          {
            action: "block",
            reason: actionText.trim() || undefined,
            kind: blockKind,
          },
          board,
        ),
      );
    } else if (actionKind === "complete") {
      result = await perform(() =>
        runHermesKanbanTaskAction(
          task.id,
          {
            action: "complete",
            summary: actionText.trim() || undefined,
            result: actionText.trim() || undefined,
          },
          board,
        ),
      );
    } else if (actionKind === "review") {
      result = await perform(() =>
        runHermesKanbanTaskAction(
          task.id,
          {
            action: "request_review",
            reviewer:
              actionAssignee === UNASSIGNED ? undefined : actionAssignee,
            summary: actionText.trim() || undefined,
          },
          board,
        ),
      );
    } else {
      result = await perform(() =>
        runHermesKanbanTaskAction(
          task.id,
          {
            action: "request_changes",
            reason: actionText.trim(),
            assignee:
              actionAssignee === UNASSIGNED ? undefined : actionAssignee,
          },
          board,
        ),
      );
    }
    if (result) setActionKind(null);
  }

  async function saveEdit() {
    const changedAssignee = editForm.assignee !== (task.assignee || UNASSIGNED);
    const ok = await perform(() =>
      updateHermesKanbanTask(
        task.id,
        {
          title: editForm.title.trim(),
          body: editForm.body.trim(),
          priority: editForm.priority,
          workspace_path:
            task.status === "running"
              ? undefined
              : editForm.workdir.trim() || undefined,
          ...(changedAssignee
            ? {
                assignee:
                  editForm.assignee === UNASSIGNED ? null : editForm.assignee,
                reclaim_running: task.status === "running",
              }
            : {}),
        },
        board,
      ),
    );
    if (ok) setEditOpen(false);
  }

  async function addComment() {
    if (!comment.trim()) return;
    const ok = await perform(() =>
      addHermesKanbanComment(task.id, comment.trim(), board),
    );
    if (ok) setComment("");
  }

  async function addDependency() {
    if (!dependency) return;
    const ok = await perform(() =>
      addHermesKanbanDependency(task.id, dependency, board),
    );
    if (ok) setDependency("");
  }

  async function uploadAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    await perform(() => uploadHermesKanbanAttachment(task.id, file, board));
  }

  async function downloadAttachment(id: number, fallbackName: string) {
    setBusy(true);
    const result = await downloadHermesKanbanAttachment(task.id, id, board);
    setBusy(false);
    if (!result.ok || !result.blob) {
      onError(result.error || t("tasks.attachments.downloadFailed"));
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename || fallbackName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-border/45 bg-background 2xl:w-[440px]">
      <header className="shrink-0 border-b border-border/40 px-4 pb-3 pt-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2">
              <KanbanStatusBadge status={task.status} />
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : null}
              <code className="truncate text-[10px] text-muted-foreground">
                {task.id}
              </code>
            </div>
            <h2 className="text-sm font-semibold leading-5">{task.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/45 px-2.5 py-2 text-[11px] text-muted-foreground">
          {task.status === "running" ? (
            <Bot className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Fingerprint className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1">{nextHandler}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3 w-3" />
            {t("common.edit")}
          </Button>
          {task.status === "review" ? (
            <>
              <Button
                size="sm"
                className="h-7 px-2"
                disabled={busy}
                onClick={() => openAction("complete")}
              >
                <CheckCircle2 className="h-3 w-3" />
                {t("tasks.action.approve")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={busy}
                onClick={() => openAction("changes")}
              >
                {t("tasks.action.requestChanges")}
              </Button>
            </>
          ) : null}
          {task.status === "blocked" || task.status === "scheduled" ? (
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  runHermesKanbanTaskAction(
                    task.id,
                    { action: "unblock" },
                    board,
                  ),
                )
              }
            >
              {t("tasks.action.unblock")}
            </Button>
          ) : null}
          {task.status === "ready" || task.status === "running" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => openAction("block")}
            >
              <AlertCircle className="h-3 w-3" />
              {t("tasks.action.block")}
            </Button>
          ) : null}
          {task.status !== "running" &&
          task.status !== "review" &&
          task.status !== "done" &&
          task.status !== "archived" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => openAction("review")}
            >
              {t("tasks.action.requestReview")}
            </Button>
          ) : null}
          {task.status === "running" || task.status === "done" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  runHermesKanbanTaskAction(
                    task.id,
                    { action: "retry", reason: "retried from Amiba" },
                    board,
                  ),
                )
              }
            >
              <RotateCcw className="h-3 w-3" />
              {task.status === "running"
                ? t("tasks.action.stopRetry")
                : t("tasks.action.retry")}
            </Button>
          ) : null}
          {task.status === "ready" ? (
            <Button
              size="sm"
              className="h-7 px-2"
              disabled={busy}
              onClick={() => openAction("complete")}
            >
              <CheckCircle2 className="h-3 w-3" />
              {t("tasks.action.complete")}
            </Button>
          ) : null}
        </div>
      </header>

      <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 h-8 w-fit bg-muted/60 p-0.5">
          <TabsTrigger value="details" className="h-7 px-3 text-xs">
            {t("tasks.tab.details")}
          </TabsTrigger>
          <TabsTrigger value="activity" className="h-7 px-3 text-xs">
            {t("tasks.tab.activity")}
            {detail?.runs.length ? (
              <span className="ml-1 text-[9px] text-muted-foreground">
                {detail.runs.length}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="details"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
              <section className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("tasks.field.status")}
                    </Label>
                    <Select
                      value={task.status}
                      disabled={
                        busy ||
                        task.status === "running" ||
                        task.status === "archived"
                      }
                      onValueChange={(value) =>
                        void perform(() =>
                          runHermesKanbanTaskAction(
                            task.id,
                            {
                              action: "move",
                              status: value as HermesKanbanStatus,
                            },
                            board,
                          ),
                        )
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!MOVABLE_STATUSES.includes(task.status) ? (
                          <SelectItem value={task.status} disabled>
                            {t(`tasks.status.${task.status}` as never)}
                          </SelectItem>
                        ) : null}
                        {MOVABLE_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {t(`tasks.status.${status}` as never)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("tasks.field.assignee")}
                    </Label>
                    <div className="flex h-8 items-center gap-1.5 rounded-md border border-input px-2 text-xs">
                      <Fingerprint className="h-3 w-3 text-muted-foreground" />
                      <span className="truncate">
                        {task.assignee || t("tasks.assignee.shortUnassigned")}
                      </span>
                    </div>
                  </div>
                </div>
                {task.body ? (
                  <p className="whitespace-pre-wrap text-xs leading-5 text-foreground/85">
                    {task.body}
                  </p>
                ) : (
                  <p className="text-xs italic text-muted-foreground">
                    {t("tasks.detail.noInstructions")}
                  </p>
                )}
                {task.workspace_path || task.branch_name ? (
                  <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                    <FolderOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-all font-mono">
                      {task.workspace_path || task.branch_name}
                    </span>
                  </div>
                ) : null}
              </section>

              {task.latest_summary || task.result ? (
                <InspectorSection
                  icon={<FileText />}
                  title={t("tasks.latestSummary")}
                >
                  <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {task.latest_summary || task.result}
                  </p>
                </InspectorSection>
              ) : null}

              <InspectorSection
                icon={<GitBranch />}
                title={t("tasks.dependencies")}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => onCreateSubtask(task.id)}
                  >
                    <Plus className="h-3 w-3" />
                    {t("tasks.subtask.create")}
                  </Button>
                }
              >
                {task.parents.length ? (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("tasks.dependencies.parents")}
                    </p>
                    {task.parents.map((id) => (
                      <TaskLinkRow
                        key={id}
                        taskId={id}
                        title={taskById.get(id)?.title}
                        onOpen={onOpenTask}
                        trailing={
                          <button
                            type="button"
                            aria-label={t("tasks.dependencies.remove")}
                            disabled={busy}
                            onClick={() =>
                              void perform(() =>
                                removeHermesKanbanDependency(
                                  task.id,
                                  id,
                                  board,
                                ),
                              )
                            }
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </button>
                        }
                      />
                    ))}
                  </div>
                ) : null}
                {task.children.length ? (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {t("tasks.dependencies.children")}
                    </p>
                    {task.children.map((id) => (
                      <TaskLinkRow
                        key={id}
                        taskId={id}
                        title={taskById.get(id)?.title}
                        onOpen={onOpenTask}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Select value={dependency} onValueChange={setDependency}>
                    <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                      <SelectValue
                        placeholder={t("tasks.dependencies.addPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {dependencyOptions.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!dependency || busy}
                    aria-label={t("tasks.dependencies.add")}
                    onClick={() => void addDependency()}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </InspectorSection>

              <InspectorSection
                icon={<MessageSquare />}
                title={t("tasks.comments")}
                count={detail?.comments.length || 0}
              >
                {detail?.comments.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg bg-muted/35 px-2.5 py-2"
                  >
                    <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-medium text-foreground/75">
                        {item.author}
                      </span>
                      <span>{formatTime(item.created_at)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-5">
                      {item.body}
                    </p>
                  </div>
                ))}
                <div className="flex items-end gap-2">
                  <Textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder={t("tasks.comments.placeholder")}
                    className="min-h-16 flex-1 resize-none text-xs"
                  />
                  <Button
                    size="icon"
                    className="h-8 w-8"
                    disabled={!comment.trim() || busy}
                    aria-label={t("tasks.comments.send")}
                    onClick={() => void addComment()}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </InspectorSection>

              <InspectorSection
                icon={<Paperclip />}
                title={t("tasks.attachments")}
                count={detail?.attachments.length || 0}
                action={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[10px]"
                    onClick={() => attachmentInput.current?.click()}
                  >
                    <Plus className="h-3 w-3" />
                    {t("tasks.attachments.add")}
                  </Button>
                }
              >
                <input
                  ref={attachmentInput}
                  type="file"
                  className="hidden"
                  onChange={(event) => void uploadAttachment(event)}
                />
                {detail?.attachments.length ? (
                  detail.attachments.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2 text-xs"
                    >
                      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{item.filename}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatBytes(item.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={t("tasks.attachments.download")}
                        disabled={busy}
                        onClick={() =>
                          void downloadAttachment(item.id, item.filename)
                        }
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("common.delete")}
                        disabled={busy}
                        onClick={() =>
                          void perform(() =>
                            deleteHermesKanbanAttachment(
                              task.id,
                              item.id,
                              board,
                            ),
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("tasks.attachments.empty")}
                  </p>
                )}
              </InspectorSection>

              <section className="flex items-center justify-between border-t border-border/45 pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={busy}
                  onClick={() =>
                    void perform(() =>
                      runHermesKanbanTaskAction(
                        task.id,
                        { action: "archive" },
                        board,
                      ),
                    ).then((ok) => {
                      if (ok) void onDeleted();
                    })
                  }
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t("tasks.action.archive")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy}
                  onClick={() => {
                    if (
                      window.confirm(
                        t("tasks.deleteConfirm", { title: task.title }),
                      )
                    ) {
                      setBusy(true);
                      void deleteHermesKanbanTask(task.id, board).then(
                        async (result) => {
                          setBusy(false);
                          if (result.ok) await onDeleted();
                          else onError(result.error || t("tasks.deleteFailed"));
                        },
                      );
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common.delete")}
                </Button>
              </section>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent
          value="activity"
          className="mt-0 min-h-0 flex-1 overflow-hidden"
        >
          <ScrollArea className="h-full">
            <div className="space-y-5 p-4">
              <InspectorSection
                icon={<Activity />}
                title={t("tasks.runs")}
                count={detail?.runs.length || 0}
              >
                {detail?.runs.length ? (
                  [...detail.runs].reverse().map((run) => (
                    <div
                      key={run.id}
                      className="rounded-lg border border-border/50 p-2.5"
                    >
                      <div className="flex items-center gap-2 text-[11px]">
                        <Badge
                          variant="outline"
                          className="h-5 rounded-full px-1.5 text-[9px]"
                        >
                          {run.outcome || run.status}
                        </Badge>
                        <span className="font-medium">
                          {run.profile || t("tasks.assignee.shortUnassigned")}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          {formatTime(run.started_at)}
                        </span>
                      </div>
                      {run.summary ? (
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                          {run.summary}
                        </p>
                      ) : null}
                      {run.error ? (
                        <p className="mt-2 whitespace-pre-wrap rounded bg-destructive/[0.06] px-2 py-1.5 text-[11px] text-destructive">
                          {run.error}
                        </p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("tasks.runs.empty")}
                  </p>
                )}
              </InspectorSection>
              <InspectorSection
                icon={<Clock3 />}
                title={t("tasks.events")}
                count={detail?.events.length || 0}
              >
                {detail?.events.length ? (
                  [...detail.events].reverse().map((event) => (
                    <div key={event.id} className="flex gap-2.5 text-xs">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/45" />
                      <div className="min-w-0 flex-1 border-b border-border/35 pb-2.5">
                        <div className="flex items-center gap-2">
                          <code className="text-[11px] text-foreground/80">
                            {event.kind}
                          </code>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {formatTime(event.created_at)}
                          </span>
                        </div>
                        {event.payload ? (
                          <pre className="mt-1 overflow-hidden whitespace-pre-wrap break-words font-sans text-[10px] leading-4 text-muted-foreground">
                            {JSON.stringify(event.payload)}
                          </pre>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("tasks.events.empty")}
                  </p>
                )}
              </InspectorSection>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <TaskFormDialog
        open={editOpen}
        title={t("tasks.edit")}
        form={editForm}
        profiles={profiles}
        chooseDirectory={getPlatform().workspaces?.chooseDirectory}
        busy={busy}
        submitLabel={t("common.save")}
        runningWarning={task.status === "running"}
        onOpenChange={setEditOpen}
        onChange={setEditForm}
        onSubmit={() => void saveEdit()}
      />

      <ActionDialog
        kind={actionKind}
        text={actionText}
        assignee={actionAssignee}
        blockKind={blockKind}
        profiles={profiles}
        busy={busy}
        onTextChange={setActionText}
        onAssigneeChange={setActionAssignee}
        onBlockKindChange={setBlockKind}
        onOpenChange={(open) => !open && setActionKind(null)}
        onSubmit={() => void submitAction()}
      />
    </aside>
  );
}

function InspectorSection({
  icon,
  title,
  count,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <header className="flex items-center gap-1.5 text-xs font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-muted-foreground">
        {icon}
        <span>{title}</span>
        {typeof count === "number" ? (
          <span className="text-[10px] font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
        {action ? <div className="ml-auto">{action}</div> : null}
      </header>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function TaskLinkRow({
  taskId,
  title,
  onOpen,
  trailing,
}: {
  taskId: string;
  title?: string;
  onOpen: (taskId: string) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/35 px-2.5 py-2 text-xs">
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left hover:underline"
        onClick={() => onOpen(taskId)}
      >
        {title || taskId}
      </button>
      {trailing ? (
        <span className="text-muted-foreground">{trailing}</span>
      ) : null}
    </div>
  );
}

function AgentProfileSelect({
  value,
  profiles,
  ariaLabel,
  allowUnassigned = false,
  onValueChange,
}: {
  value: string;
  profiles: HermesProfile[];
  ariaLabel: string;
  allowUnassigned?: boolean;
  onValueChange: (value: string) => void;
}) {
  const { t } = useT();
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned ? (
          <SelectItem value={UNASSIGNED}>
            {t("tasks.assignee.unassigned")}
          </SelectItem>
        ) : null}
        {profiles.map((profile) => (
          <SelectItem key={profile.name} value={profile.name}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{profile.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TaskFormFields({
  form,
  profiles,
  chooseDirectory,
  allowUnassigned = true,
  onChange,
}: {
  form: TaskFormState;
  profiles: HermesProfile[];
  chooseDirectory?: (initialPath?: string) => Promise<string | null>;
  allowUnassigned?: boolean;
  onChange: (form: TaskFormState) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="kanban-task-title">{t("tasks.field.title")}</Label>
        <Input
          id="kanban-task-title"
          autoFocus
          value={form.title}
          onChange={(event) => onChange({ ...form, title: event.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kanban-task-body">{t("tasks.field.body")}</Label>
        <Textarea
          id="kanban-task-body"
          value={form.body}
          onChange={(event) => onChange({ ...form, body: event.target.value })}
          className="min-h-28 resize-y"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("tasks.field.assignee")}</Label>
          <AgentProfileSelect
            value={form.assignee}
            profiles={profiles}
            ariaLabel={t("tasks.field.assignee")}
            allowUnassigned={allowUnassigned}
            onValueChange={(assignee) => onChange({ ...form, assignee })}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("tasks.field.priority")}</Label>
          <Select
            value={String(form.priority)}
            onValueChange={(priority) =>
              onChange({ ...form, priority: Number(priority) })
            }
          >
            <SelectTrigger aria-label={t("tasks.field.priority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5].map((priority) => (
                <SelectItem key={priority} value={String(priority)}>
                  {priority === 0 ? t("tasks.priority.normal") : `P${priority}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <WorkdirField
        value={form.workdir}
        chooseDirectory={chooseDirectory}
        onChange={(workdir) => onChange({ ...form, workdir })}
      />
    </div>
  );
}

function WorkdirField({
  value,
  chooseDirectory,
  onChange,
}: {
  value: string;
  chooseDirectory?: (initialPath?: string) => Promise<string | null>;
  onChange: (value: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="kanban-task-workdir">{t("tasks.field.workdir")}</Label>
      <div className="flex gap-2">
        <Input
          id="kanban-task-workdir"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="$HOME"
          className="min-w-0 flex-1 font-mono text-xs"
        />
        {chooseDirectory ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label={t("tasks.field.chooseWorkdir")}
            onClick={() =>
              void chooseDirectory(value || undefined).then(
                (path) => path && onChange(path),
              )
            }
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TaskFormDialog({
  open,
  title,
  form,
  profiles,
  chooseDirectory,
  busy,
  submitLabel,
  runningWarning,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  form: TaskFormState;
  profiles: HermesProfile[];
  chooseDirectory?: (initialPath?: string) => Promise<string | null>;
  busy: boolean;
  submitLabel: string;
  runningWarning?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: TaskFormState) => void;
  onSubmit: () => void;
}) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("tasks.form.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {runningWarning ? (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {t("tasks.edit.runningWarning")}
            </div>
          ) : null}
          <TaskFormFields
            form={form}
            profiles={profiles}
            chooseDirectory={chooseDirectory}
            onChange={onChange}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy || !form.title.trim()} onClick={onSubmit}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionDialog({
  kind,
  text,
  assignee,
  blockKind,
  profiles,
  busy,
  onTextChange,
  onAssigneeChange,
  onBlockKindChange,
  onOpenChange,
  onSubmit,
}: {
  kind: "block" | "complete" | "review" | "changes" | null;
  text: string;
  assignee: string;
  blockKind: string;
  profiles: HermesProfile[];
  busy: boolean;
  onTextChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onBlockKindChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  const { t } = useT();
  if (!kind) return null;
  const needsAssignee = kind === "review" || kind === "changes";
  const requiredText = kind === "changes";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="compact">
        <DialogHeader>
          <DialogTitle>{t(`tasks.dialog.${kind}.title` as never)}</DialogTitle>
          <DialogDescription className="sr-only">
            {t(`tasks.dialog.${kind}.placeholder` as never)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "block" ? (
            <div className="space-y-1.5">
              <Label>{t("tasks.block.kind")}</Label>
              <Select value={blockKind} onValueChange={onBlockKindChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["needs_input", "capability", "transient", "dependency"].map(
                    (value) => (
                      <SelectItem key={value} value={value}>
                        {t(`tasks.block.${value}` as never)}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {needsAssignee ? (
            <div className="space-y-1.5">
              <Label>
                {kind === "review"
                  ? t("tasks.field.reviewer")
                  : t("tasks.field.assignee")}
              </Label>
              <Select value={assignee} onValueChange={onAssigneeChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>
                    {t("tasks.assignee.shortUnassigned")}
                  </SelectItem>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.name} value={profile.name}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="task-action-text">
              {kind === "complete" || kind === "review"
                ? t("tasks.field.handoff")
                : t("tasks.field.reason")}
            </Label>
            <Textarea
              id="task-action-text"
              autoFocus
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              className="min-h-24 resize-y"
              placeholder={t(`tasks.dialog.${kind}.placeholder` as never)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={busy || (requiredText && !text.trim())}
            onClick={onSubmit}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t(`tasks.dialog.${kind}.submit` as never)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
