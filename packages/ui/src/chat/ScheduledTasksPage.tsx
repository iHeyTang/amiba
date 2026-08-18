import { DshScheduledTasksPage } from "./DshScheduledTasksPage";
import { useSessions } from "@amiba/app-runtime/core";
import { getPlatform } from "@amiba/app-runtime/platform";

export interface ScheduledTasksPageProps {
  topBarHeightPx?: number;
  topBarClassName?: string;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  onExpandSidebar?: () => void;
}

export function ScheduledTasksPage(props: ScheduledTasksPageProps = {}) {
  const sessions = useSessions();
  const platform = getPlatform();
  if (!platform.agentSchedules || !platform.agentSessions) return null;
  return (
    <DshScheduledTasksPage
      {...props}
      activeSessionId={sessions.activeId || undefined}
      adapter={platform.agentSchedules}
      sessionsAdapter={platform.agentSessions}
    />
  );
}
