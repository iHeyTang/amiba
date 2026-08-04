import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  FolderOpen,
  Fingerprint,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createHermesKanbanTask,
  getHermesKanbanBoards,
  getHermesKanbanTasks,
  getHermesProfiles,
  type HermesKanbanBoard,
  type HermesKanbanStatus,
  type HermesKanbanTask,
  type HermesProfile,
} from "@amiba/core";
import { useT } from "@amiba/i18n";
import { getPlatform } from "@amiba/platform";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
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
  Textarea,
} from "../primitives";
import { KanbanStatusBadge } from "./KanbanStatusBadge";

const BOARD_GROUPS: Array<{
  key: string;
  statuses: HermesKanbanStatus[];
  icon: typeof CircleDot;
}> = [
  {
    key: "planning",
    statuses: ["triage", "todo", "scheduled"],
    icon: Clock3,
  },
  { key: "ready", statuses: ["ready"], icon: CircleDot },
  { key: "running", statuses: ["running"], icon: Bot },
  {
    key: "attention",
    statuses: ["blocked", "review"],
    icon: AlertCircle,
  },
  { key: "done", statuses: ["done"], icon: CheckCircle2 },
];

function TaskCard({
  task,
  onClick,
}: {
  task: HermesKanbanTask;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-border/55 bg-background px-3 py-2.5 text-left shadow-sm transition-colors hover:border-border hover:bg-accent/30"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-5">
          {task.title}
        </h3>
        {task.priority > 0 && (
          <span className="shrink-0 text-[10px] font-medium text-amber-600">
            P{task.priority}
          </span>
        )}
      </div>
      <div className="mt-2 flex min-w-0 items-center gap-1.5">
        <KanbanStatusBadge status={task.status} />
        {task.assignee && (
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-muted-foreground">
            <Fingerprint className="h-3 w-3 shrink-0" />
            {task.assignee}
          </span>
        )}
      </div>
    </button>
  );
}

function TaskColumn({
  groupKey,
  Icon,
  tasks,
  onOpen,
}: {
  groupKey: string;
  Icon: typeof CircleDot;
  tasks: HermesKanbanTask[];
  onOpen: (task: HermesKanbanTask) => void;
}) {
  const { t } = useT();
  return (
    <section className="flex min-h-0 w-64 shrink-0 flex-col rounded-2xl bg-muted/30">
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
            <TaskCard key={task.id} task={task} onClick={() => onOpen(task)} />
          ))}
          {tasks.length === 0 && (
            <div className="flex h-16 items-center justify-center text-[11px] text-muted-foreground/60">
              {t("tasks.column.empty")}
            </div>
          )}
        </div>
      </ScrollArea>
    </section>
  );
}

export function TaskCenterPage() {
  const { t } = useT();
  const [boards, setBoards] = useState<HermesKanbanBoard[]>([]);
  const [board, setBoard] = useState("default");
  const [tasks, setTasks] = useState<HermesKanbanTask[]>([]);
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<HermesKanbanTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [activeProfile, setActiveProfile] = useState("default");
  const [assignee, setAssignee] = useState("__unassigned__");
  const [workdir, setWorkdir] = useState("");
  const [creating, setCreating] = useState(false);
  const chooseDirectory = getPlatform().workspaces?.chooseDirectory;

  const openCreateDialog = useCallback(() => {
    setCreateOpen(true);
    if (workdir) return;
    const workspaces = getPlatform().workspaces;
    if (!workspaces) return;
    void workspaces.getDefaultRoot().then((root) => {
      setWorkdir((value) => value || root);
    });
  }, [workdir]);

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

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesKanbanTasks({ board });
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("tasks.loadFailed"));
      return;
    }
    setTasks(result.tasks);
  }, [board, t]);

  useEffect(() => {
    void loadBoards();
    void getHermesProfiles().then((result) => {
      if (!result.ok) return;
      setProfiles(result.profiles);
      setActiveProfile(result.active);
      setAssignee((value) =>
        value === "__unassigned__" ? result.active : value,
      );
    });
  }, [loadBoards]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((task) =>
      [task.title, task.body, task.assignee, task.latest_summary]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [query, tasks]);

  async function createTask() {
    if (!title.trim()) return;
    setCreating(true);
    const result = await createHermesKanbanTask(
      {
        title: title.trim(),
        body: body.trim() || undefined,
        assignee: assignee === "__unassigned__" ? undefined : assignee,
        workspace_path: workdir.trim() || undefined,
      },
      board,
    );
    setCreating(false);
    if (!result.ok) {
      setError(result.error || t("tasks.createFailed"));
      return;
    }
    setCreateOpen(false);
    setTitle("");
    setBody("");
    setAssignee(activeProfile);
    setWorkdir("");
    await Promise.all([loadTasks(), loadBoards()]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 px-4">
        {boards.length > 1 ? (
          <Select value={board} onValueChange={setBoard}>
            <SelectTrigger className="h-8 w-auto min-w-40 border-0 bg-muted/60 text-xs shadow-none">
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
        ) : null}
        <div className="relative ml-auto w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 rounded-full pl-8 text-xs"
            placeholder={t("tasks.search")}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label={t("common.refresh")}
          onClick={() => void Promise.all([loadTasks(), loadBoards()])}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8"
          onClick={openCreateDialog}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("tasks.create")}
        </Button>
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-lg bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto px-4 pb-4">
        {loading && tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex h-full min-w-max gap-3">
            {BOARD_GROUPS.map(({ key, statuses, icon }) => (
              <TaskColumn
                key={key}
                groupKey={key}
                Icon={icon}
                tasks={filtered.filter((task) =>
                  statuses.includes(task.status),
                )}
                onOpen={setSelected}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("tasks.create")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="kanban-task-title">
                {t("tasks.field.title")}
              </Label>
              <Input
                id="kanban-task-title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kanban-task-body">{t("tasks.field.body")}</Label>
              <Textarea
                id="kanban-task-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-28 resize-y"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("tasks.field.assignee")}</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__unassigned__">
                      {t("tasks.assignee.unassigned")}
                    </SelectItem>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.name} value={profile.name}>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Fingerprint className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{profile.name}</span>
                          {profile.description ? (
                            <span className="max-w-40 truncate text-[10px] text-muted-foreground">
                              {profile.description}
                            </span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kanban-task-workdir">
                  {t("tasks.field.workdir")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="kanban-task-workdir"
                    value={workdir}
                    onChange={(event) => setWorkdir(event.target.value)}
                    placeholder="$HOME"
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  {chooseDirectory && (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full"
                      aria-label={t("tasks.field.chooseWorkdir")}
                      onClick={() => {
                        void chooseDirectory(workdir || undefined).then(
                          (path) => path && setWorkdir(path),
                        );
                      }}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={creating || !title.trim()}
              onClick={() => void createTask()}
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("tasks.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[78vh] max-w-xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8 leading-snug">
                  {selected.title}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <KanbanStatusBadge status={selected.status} />
                {selected.assignee && (
                  <Badge variant="outline" className="rounded-full">
                    <Fingerprint className="mr-1 h-3 w-3" />
                    {selected.assignee}
                  </Badge>
                )}
                <code className="text-[10px] text-muted-foreground">
                  {selected.id}
                </code>
              </div>
              {selected.body && (
                <p className="whitespace-pre-wrap text-sm leading-6 text-foreground/85">
                  {selected.body}
                </p>
              )}
              {selected.latest_summary && (
                <section className="rounded-xl bg-muted/40 p-3">
                  <h3 className="mb-1 text-xs font-semibold">
                    {t("tasks.latestSummary")}
                  </h3>
                  <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                    {selected.latest_summary}
                  </p>
                </section>
              )}
              {(selected.workspace_path || selected.branch_name) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span className="truncate">
                    {selected.workspace_path || selected.branch_name}
                  </span>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
