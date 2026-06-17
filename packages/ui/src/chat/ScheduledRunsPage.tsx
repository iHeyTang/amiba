/**
 * Scheduled-tasks page — the cron-run list rendered inside the MAIN pane
 * (previously a `w-72` aside under the activity bar). Data + per-job section
 * labels/actions come from `useScheduledRuns`. Opening a run hands the id back
 * to the host, which activates the session and swaps the main pane to the chat
 * surface.
 */
import { useT } from "@amiba/i18n";
import { SessionsListView } from "./SessionsListView";
import { useScheduledRuns } from "./internal/useScheduledRuns";

export interface ScheduledRunsPageProps {
  query: string;
  activeId: string;
  onOpenRun: (id: string) => void;
}

export function ScheduledRunsPage({
  query,
  activeId,
  onOpenRun,
}: ScheduledRunsPageProps) {
  const { t } = useT();
  const scheduled = useScheduledRuns();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
    </div>
  );
}
