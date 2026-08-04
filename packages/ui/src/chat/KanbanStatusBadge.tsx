import type { HermesKanbanStatus } from "@amiba/core";
import { useT, type TranslateFn } from "@amiba/i18n";

import { cn } from "../primitives";

export function kanbanStatusLabel(
  t: TranslateFn,
  status: HermesKanbanStatus,
): string {
  return t(`tasks.status.${status}` as never);
}

export function KanbanStatusBadge({ status }: { status: HermesKanbanStatus }) {
  const { t } = useT();
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium",
        status === "done" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "running" && "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        status === "blocked" && "bg-red-500/10 text-red-700 dark:text-red-300",
        status === "review" &&
          "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        ["triage", "todo", "scheduled", "ready"].includes(status) &&
          "bg-muted text-muted-foreground",
      )}
    >
      {kanbanStatusLabel(t, status)}
    </span>
  );
}
