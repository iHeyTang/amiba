import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { NavigationRow, usePluginT } from "@amiba/ui/plugin";
import { CalendarClock } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { reconcileRuns, runUnread, taskRuns } from "./activity.js";
import { useCronTasks } from "./use-cron-tasks.js";

import { AMIBA_CRON_REMOTE } from "../remote.js";
import { DshCronPage, type CronAdapter } from "./DshCronPage.js";
import { createCronSessionGroup } from "./session-group.js";
import { cronI18n } from "./i18n.js";
import { CRON_TOOLVIEW_KEYS, CronToolview } from "./toolviews.js";

export const name = "amiba-cron-ui";
export const inject = ["slots", "remote", "layout"];

const VIEW_ID = "cron";
type CronRemote = ClientContext["remote"]["amibaCron"];

function copy() {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "定时任务"
    : "Cron tasks";
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

export function CronNavigation({
  activeView,
  openWorkspace,
  sessionActivity,
  adapter,
}: Pick<
  PropsRuntime<"amiba.workspace.navigation">,
  "activeView" | "openWorkspace" | "sessionActivity"
> & {
  adapter: CronAdapter;
}): ReactNode {
  const { t } = usePluginT(cronI18n);
  const label = t("cron.nav");
  const { tasks } = useCronTasks(
    adapter,
    sessionActivity?.sessions.map((session) => session.id),
  );
  const unread = tasks.some((task) =>
    taskRuns(task).some((run) => runUnread(run, sessionActivity)),
  );
  useEffect(() => {
    if (sessionActivity)
      void reconcileRuns(tasks, sessionActivity).catch(console.error);
  }, [tasks, sessionActivity]);
  return (
    <NavigationRow
      active={activeView === VIEW_ID}
      aria-label={label}
      data-testid="sidebar-item-cron"
      icon={<CalendarClock />}
      label={label}
      trailing={
        unread ? (
          <span
            role="status"
            aria-label={t("cron.unread")}
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--status-session))]"
          />
        ) : undefined
      }
      onClick={() => openWorkspace(VIEW_ID)}
      title={label}
    />
  );
}

type CronViewProps = PropsRuntime<"amiba.workspace.view"> & {
  adapter: CronAdapter;
  expandSidebar(): void;
  startChat(seedPrompt: string): void;
};

function CronView({
  adapter,
  chromeHeightPx,
  expandSidebar,
  showSidebarExpandControl = false,
  sidebarCollapsed = false,
  startChat,
  sessionActivity,
  topBarLeftInset,
}: CronViewProps): ReactNode {
  return (
    <DshCronPage
      adapter={adapter}
      sessionActivity={sessionActivity}
      topBarHeightPx={chromeHeightPx}
      topBarLeftInset={topBarLeftInset}
      sidebarCollapsed={sidebarCollapsed}
      showSidebarExpandControl={showSidebarExpandControl}
      onExpandSidebar={expandSidebar}
      onStartChat={startChat}
      onOpenSession={(sessionId) => {
        // The host's open-by-id seam: FullScreenChatView routes this to the
        // sessions store, which admits any valid DSH session id.
        window.dispatchEvent(
          new CustomEvent("amiba:open-session", { detail: { sessionId } }),
        );
      }}
    />
  );
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_CRON_REMOTE);
  const fiber = ctx.inject(
    ["slots", "remote.amibaCron", "layout"],
    (injectedCtx) => {
      const remote: CronRemote = injectedCtx.remote.amibaCron;
      const group = createCronSessionGroup((ids) =>
        valueOf(remote.sessionIds(ids)),
      );
      const disposeGroup = injectedCtx.slots.inject(
        "amiba.sessions.list.group",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.sessions.list.group",
              id: VIEW_ID,
              order: 100,
              label: copy,
              inject: () => group.face,
            },
            () => null,
          ),
      );
      const adapter: CronAdapter = {
        list: (ids) => valueOf(remote.list(ids)),
        create: (input) => valueOf(remote.createTask(input)),
        update: (id, patch) => valueOf(remote.updateTask(id, patch)),
        removeTask: async (id) => {
          await valueOf(remote.removeTask(id));
        },
        runNow: (id) => valueOf(remote.runNow(id)),
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
              inject: () => ({ adapter }),
            },
            CronNavigation,
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
              startChat: (seedPrompt: string) =>
                injectedCtx.layout.openNewChat(seedPrompt),
            }),
          },
          CronView,
        ),
      );
      // slots.inject defers the registration until the seat's declarer
      // (ui-shell's root) has published the children table — plugin load
      // order must not matter.
      const disposeToolviews = CRON_TOOLVIEW_KEYS.map((key) =>
        injectedCtx.slots.inject("tool.call.toolview", () =>
          injectedCtx.slots.register(
            { name: "tool.call.toolview", key },
            CronToolview,
          ),
        ),
      );
      return () => {
        for (const dispose of disposeToolviews) dispose();
        disposeGroup();
        group.dispose();
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
