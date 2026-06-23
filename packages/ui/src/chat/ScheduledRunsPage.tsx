/**
 * Scheduled-tasks page — a master/detail split rendered inside the MAIN
 * pane. The LEFT column ("sidebar") is the cron-run list grouped by job
 * (data + per-job labels/actions from `useScheduledRuns`); the RIGHT column
 * ("main content") shows the selected run via the `detail` slot the host
 * supplies — the host passes a `<ChatSurface>` bound to the active session
 * when a run is selected, and nothing when it isn't (we fall back to a
 * centred placeholder).
 *
 * Opening a run hands the id back to the host through `onOpenRun`, which
 * activates the session; the active id then both highlights the row here
 * and drives what the host renders into `detail`.
 */
import type { ReactNode } from "react";
import { useT } from "@amiba/i18n";
import { SessionsListView } from "./SessionsListView";
import { useScheduledRuns } from "./internal/useScheduledRuns";

export interface ScheduledRunsPageProps {
  query: string;
  activeId: string;
  onOpenRun: (id: string) => void;
  /**
   * Right-pane content for the selected run. Host passes a `<ChatSurface>`
   * bound to the active session when a run is selected; when omitted, the
   * page shows its own "select a run" placeholder.
   */
  detail?: ReactNode;
}

export function ScheduledRunsPage({
  query,
  activeId,
  onOpenRun,
  detail,
}: ScheduledRunsPageProps) {
  const { t } = useT();
  const scheduled = useScheduledRuns();
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-border/40">
        <SessionsListView
          sessions={scheduled.runs}
          activeId={activeId}
          ready={scheduled.ready}
          query={query}
          onOpen={onOpenRun}
          onRename={() => {}}
          onDelete={() => {}}
          onRefresh={scheduled.refresh}
          emptyLabel={t("sidepanel.sessions.scheduled.empty")}
          sectionLabelFor={scheduled.labelFor}
          sectionActionsFor={scheduled.actionsFor}
        />
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {detail ?? <ScheduledRunsEmptyDetail />}
      </div>
    </div>
  );
}

/** Centred placeholder shown in the detail pane when no run is selected. */
function ScheduledRunsEmptyDetail() {
  const { t } = useT();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
      <p className="text-sm text-muted-foreground">
        {t("sidepanel.sessions.scheduled.selectRun")}
      </p>
    </div>
  );
}
