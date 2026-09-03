import { Badge, Button, Popover, PopoverContent, PopoverTrigger, usePluginT } from "@amiba/ui/plugin";
import { ListTodo } from "lucide-react";
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";

import type { StewardTask, StewardTaskStatus } from "../types.js";
import { stewardI18n } from "./i18n.js";
import type { StewardClientState } from "./state.js";

export interface TaskBoardProps {
  /** Framework-resolved current session id (from the session standard kit). */
  sessionId: string;
  state: StewardClientState;
  listTasks(includeDone: boolean): Promise<StewardTask[]>;
  openSession(sessionId: string): void;
}

const STATUS_KEY: Record<StewardTaskStatus, string> = {
  idle: "steward.status.idle",
  running: "steward.status.running",
  needs_input: "steward.status.needs_input",
  failed: "steward.status.failed",
  done: "steward.status.done",
};

export function TaskBoard({ sessionId, state, listTasks, openSession }: TaskBoardProps): ReactNode {
  const { t } = usePluginT(stewardI18n);
  const stewardId = useSyncExternalStore(state.subscribe, state.stewardSessionId);
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<StewardTask[] | null>(null);
  const refresh = useCallback(() => {
    setTasks(null);
    void listTasks(false).then(setTasks).catch(() => setTasks([]));
  }, [listTasks]);
  if (!stewardId || sessionId !== stewardId) return null;
  const label = t("steward.board.open");
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} title={label} data-testid="steward-task-board">
          <ListTodo className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">{t("steward.board.title")}</div>
        <div className="max-h-96 overflow-y-auto">
          {tasks === null ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">{t("steward.board.loading")}</div>
          ) : tasks.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">{t("steward.board.empty")}</div>
          ) : (
            <ul className="divide-y">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      setOpen(false);
                      openSession(task.sessionId);
                    }}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm">{task.title}</span>
                      <Badge variant={task.status === "needs_input" || task.status === "failed" ? "destructive" : "secondary"}>
                        {t(STATUS_KEY[task.status])}
                      </Badge>
                    </span>
                    {task.lastSummary ? (
                      <span className="truncate text-xs text-muted-foreground">{task.lastSummary}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
