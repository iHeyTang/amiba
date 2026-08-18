import type { AgentSessionSummary } from "@amiba/app-runtime/platform";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { NavigationRow, usePluginT } from "@amiba/ui/plugin";
import { Workflow } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { AMIBA_SCHEDULES_REMOTE } from "../remote.js";
import type { AgentSchedulesAdapter } from "../types.js";
import { DshScheduledTasksPage as ScheduleWorkspaceView } from "./DshScheduledTasksPage.js";

export const name = "amiba-schedules-ui";
export const inject = ["slots", "remote", "layout"];

const VIEW_ID = "scheduled";
type SchedulesRemote = ClientContext["remote"]["amibaSchedules"];

function copy() {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "定时任务"
    : "Scheduled tasks";
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(
  promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

function ScheduleNavigation({
  activeView,
  openWorkspace,
}: PropsRuntime<"amiba.workspace.navigation">): ReactNode {
  const { language } = usePluginT();
  const label = language === "zh-CN" ? "定时任务" : "Scheduled tasks";
  return (
    <NavigationRow
      active={activeView === VIEW_ID}
      aria-label={label}
      data-testid="sidebar-item-scheduled"
      icon={<Workflow />}
      label={label}
      onClick={() => openWorkspace(VIEW_ID)}
      title={label}
    />
  );
}

type ScheduleViewProps = PropsRuntime<"amiba.workspace.view"> & {
  adapter: AgentSchedulesAdapter;
  expandSidebar(): void;
};

function ScheduleView({
  adapter,
  chromeHeightPx,
  expandSidebar,
  showSidebarExpandControl = false,
  sidebarCollapsed = false,
  topBarLeftInset,
  useSessions,
}: ScheduleViewProps): ReactNode {
  const sessionState = useSessions((state) => state);
  const sessionsAdapter = useMemo(
    () => ({
      list: async (): Promise<AgentSessionSummary[]> =>
        sessionState.ids
          .map((id) => sessionState.byId[id])
          .filter((item) => !!item)
          .map((item) => ({
            sessionId: item.id,
            updatedAt: item.updatedAt,
            running: item.running,
            blank: item.blank,
            ...(item.parentId ? { parentSessionId: item.parentId } : {}),
            ...(item.origin ? { origin: item.origin } : {}),
            ...(item.cwd ? { cwd: item.cwd } : {}),
            ...(item.agentPreset ? { agentPreset: item.agentPreset } : {}),
            ...(item.title ? { title: item.title } : {}),
          })),
    }),
    [sessionState],
  );
  return (
    <ScheduleWorkspaceView
      activeSessionId={sessionState.current}
      adapter={adapter}
      onExpandSidebar={expandSidebar}
      sessionsAdapter={sessionsAdapter}
      showSidebarExpandControl={showSidebarExpandControl}
      sidebarCollapsed={sidebarCollapsed}
      topBarHeightPx={chromeHeightPx}
      topBarLeftInset={topBarLeftInset}
    />
  );
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_SCHEDULES_REMOTE);
  const fiber = ctx.inject(
    ["slots", "remote.amibaSchedules", "layout"],
    (injectedCtx) => {
      const remote: SchedulesRemote = injectedCtx.remote.amibaSchedules;
      const adapter: AgentSchedulesAdapter = {
        list: (sessionId) => valueOf(remote.list(sessionId)),
        create: (sessionId, input) => valueOf(remote.create(sessionId, input)),
        remove: (sessionId, id) =>
          valueOf(remote.removeSchedule(sessionId, id)),
      };
      const disposeNavigation = injectedCtx.slots.inject(
        "amiba.workspace.navigation",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.workspace.navigation",
              id: VIEW_ID,
              order: 100,
              label: copy,
            },
            ScheduleNavigation,
          ),
      );
      const disposeView = injectedCtx.slots.inject("amiba.workspace.view", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.workspace.view",
            id: VIEW_ID,
            order: 100,
            label: copy,
            inject: () => ({
              adapter,
              expandSidebar: () => injectedCtx.layout.toggleSidebar(),
            }),
          },
          ScheduleView,
        ),
      );
      return () => {
        disposeView();
        disposeNavigation();
      };
    },
  );
  await fiber;
  return async () => {
    await fiber.dispose();
    await disposeRemote();
  };
}
