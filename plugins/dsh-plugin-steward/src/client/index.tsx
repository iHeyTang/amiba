import { TOOLVIEWS } from "./toolviews.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";
import { ConciergeBell } from "lucide-react";
import { AMIBA_STEWARD_REMOTE } from "../remote.js";
import { STEWARD_SOURCE } from "../types.js";
import { StewardNavigation } from "./StewardNavigation.js";
import { StewardDirectory } from "./StewardDirectory.js";
import { createStewardClientState, stewardGroupFace } from "./state.js";

export const name = "amiba-steward-ui";
export const inject = [
  "slots",
  "remote",
  "layout",
  "sessions",
  "amibaSessionVisibility",
];
function NoopComponent(): ReactNode {
  return null;
}
async function valueOf<T>(
  promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok)
    throw new Error(
      String((result.error as { message?: string })?.message ?? result.error),
    );
  return result.value;
}
function openSession(sessionId: string) {
  window.dispatchEvent(
    new CustomEvent("amiba:open-session", { detail: { sessionId } }),
  );
}
const copy = () =>
  document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "管家"
    : "Stewards";

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => {
    const disposers = TOOLVIEWS.map(({ key, component }) =>
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register({ name: "tool.call.toolview", key }, component),
      ),
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  });
  const disposeRemote = await ctx.remote.$mount(AMIBA_STEWARD_REMOTE);
  const fiber = ctx.inject(
    [
      "slots",
      "remote.amibaSteward",
      "layout",
      "sessions",
      "amibaSessionVisibility",
    ],
    (injectedCtx) => {
      const remote = injectedCtx.remote.amibaSteward;
      const hidden = new Map<string, () => void>();
      const entries = new Map<
        string,
        {
          state: ReturnType<typeof createStewardClientState>;
          name: string;
          dispose(): void;
        }
      >();
      let allSessions = new Set<string>(),
        allTasks = new Set<string>();
      let disposed = false;
      const open = async (id: string) => {
        const result = await valueOf(remote.ensureStewardSession(id));
        injectedCtx.layout.openChat();
        openSession(result.sessionId);
        await refresh();
      };
      let pending: Promise<void> | undefined;
      const refresh = (): Promise<void> =>
        (pending ??= (async () => {
          const rows = await valueOf(remote.instances());
          if (disposed) return;
          allSessions = new Set(rows.flatMap((item) => item.sessionIds));
          allTasks = new Set(
            rows.flatMap((item) =>
              item.state.tasks.map((task) => task.sessionId),
            ),
          );
          for (const [id, release] of hidden)
            if (!allSessions.has(id)) {
              release();
              hidden.delete(id);
            }
          for (const id of allSessions)
            if (!hidden.has(id))
              hidden.set(
                id,
                injectedCtx.amibaSessionVisibility.hideSession(id),
              );
          for (const [id, entry] of entries)
            if (
              !rows.some((item) => item.id === id && item.name === entry.name)
            ) {
              entry.dispose();
              entries.delete(id);
            }
          for (const item of rows) {
            if (!entries.has(item.id)) {
              const state = createStewardClientState();
              const navigation = injectedCtx.slots.inject(
                "amiba.workspace.navigation",
                () =>
                  injectedCtx.slots.register(
                    {
                      name: "amiba.workspace.navigation",
                      id: `steward-${item.id}`,
                      order: 90,
                      label: () => item.name,
                      inject: () => ({
                        state,
                        label: item.name,
                        open: () => {
                          void open(item.id).catch(console.error);
                        },
                      }),
                    },
                    StewardNavigation as (
                      props: PropsRuntime<"amiba.workspace.navigation">,
                    ) => ReactNode,
                  ),
              );
              const group = injectedCtx.slots.inject(
                "amiba.sessions.list.group",
                () =>
                  injectedCtx.slots.register(
                    {
                      name: "amiba.sessions.list.group",
                      id: `steward-${item.id}`,
                      order: 50,
                      label: () => item.name,
                      inject: () => stewardGroupFace(state),
                    },
                    NoopComponent,
                  ),
              );
              const menu = injectedCtx.slots.inject(
                "amiba.sessions.item.menu",
                () =>
                  injectedCtx.slots.register(
                    {
                      name: "amiba.sessions.item.menu",
                      id: `steward-adopt-${item.id}`,
                      order: 50,
                      label: () =>
                        document.documentElement.lang.startsWith("zh")
                          ? `交给 ${item.name}`
                          : `Hand to ${item.name}`,
                      inject: () => ({
                        visible: (session: { id: string }) =>
                          !allSessions.has(session.id) &&
                          !allTasks.has(session.id),
                        run: async (session: { id: string }) => {
                          await valueOf(
                            remote.adopt({
                              stewardId: item.id,
                              sessionId: session.id,
                            }),
                          );
                          await refresh();
                        },
                        subscribe: state.subscribe,
                      }),
                    },
                    NoopComponent,
                  ),
              );
              entries.set(item.id, {
                state,
                name: item.name,
                dispose: () => {
                  navigation();
                  group();
                  menu();
                },
              });
            }
            const state = entries.get(item.id)!.state;
            state.setStewardSessionIds(item.sessionIds);
            if (item.state.stewardSessionId)
              state.setStewardSessionId(item.state.stewardSessionId);
            const tasks = await valueOf(
              remote.listTasks({ stewardId: item.id, includeDone: true }),
            );
            if (!disposed)
              state.setAdopted(tasks.map((task) => task.sessionId));
          }
        })().finally(() => {
          pending = undefined;
        }));
      const list = () => valueOf(remote.instances());
      const save: import("./StewardDirectory.js").DirectoryProps["save"] =
        async (input) => {
          const row = await valueOf(remote.saveInstance(input));
          await refresh();
          return row;
        };
      const remove = async (id: string) => {
        const result = await valueOf(remote.deleteInstance(id));
        await refresh();
        return result;
      };
      const settings: import("./StewardDirectory.js").DirectoryProps["settings"] =
        (input) => valueOf(remote.conversationSettings(input));
      const disposeSettings = injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: "steward",
            order: 290,
            label: copy,
            inject: () => ({ navIcon: () => <ConciergeBell /> }),
          },
          () => (
            <StewardDirectory
              list={list}
              save={save}
              remove={remove}
              open={open}
              settings={settings}
              openSession={(id) => {
                injectedCtx.layout.openChat();
                openSession(id);
              }}
            />
          ),
        ),
      );
      const source = injectedCtx.slots.inject("amiba.message.source", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.message.source",
            id: STEWARD_SOURCE,
            order: 50,
            label: copy,
          },
          NoopComponent,
        ),
      );
      const openEntry = (event: Event) => {
        const id = (event as CustomEvent<{ id?: string }>).detail?.id;
        if (id) void open(id).catch(console.error);
      };
      window.addEventListener("amiba:open-steward", openEntry);
      void refresh().catch(console.error);
      const interval = setInterval(() => {
        void refresh().catch(console.error);
      }, 5000);
      return () => {
        window.removeEventListener("amiba:open-steward", openEntry);
        disposed = true;
        clearInterval(interval);
        source();
        disposeSettings();
        for (const entry of entries.values()) entry.dispose();
        for (const release of hidden.values()) release();
      };
    },
  );
  await fiber;
  return async () => {
    await fiber.dispose();
    await disposeRemote();
  };
}
