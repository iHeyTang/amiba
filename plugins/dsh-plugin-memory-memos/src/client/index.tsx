import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { WorkspaceNavigationRow, usePluginT } from "@amiba/ui/plugin";
import { MemoryPage } from "./MemoryPage.js";
import { Brain } from "lucide-react";
import { AMIBA_MEMORY_REMOTE } from "../remote.js";
import { createMemoryAdapter } from "./memory-adapter.js";
import { MemosPanel } from "./MemosPanel.js";

export const name = "amiba-memory-memos-ui";
export const inject = ["slots", "remote", "layout"];
const SECTION_ID = "memory";

function labels() {
  return {
    nav: document.documentElement.lang.startsWith("zh")
      ? "助手记忆"
      : "Assistant memory",
  };
}

function MemoryNavigation({
  activeView,
  openWorkspace,
}: PropsRuntime<"amiba.workspace.navigation">) {
  const { language } = usePluginT();
  const label = language.startsWith("zh") ? "助手记忆" : "Assistant memory";
  return (
    <WorkspaceNavigationRow
      navigation={{ activeView }}
      target={{ kind: "workspace", viewId: SECTION_ID }}
      icon={<Brain />}
      label={label}
      title={label}
      onClick={() => openWorkspace(SECTION_ID)}
    />
  );
}

/** The plugin owns both its workspace and settings contributions. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MEMORY_REMOTE);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaMemory", "layout"],
    (ready) => {
      const remote = ready.remote.amibaMemory;
      let storage: Storage | undefined;
      try {
        storage = window.localStorage;
      } catch {
        /* Use an in-memory session if storage is unavailable. */
      }
      const adapter = createMemoryAdapter(remote, storage);
      const disposeNavigation = ready.slots.inject(
        "amiba.workspace.navigation",
        () =>
          ready.slots.register(
            {
              name: "amiba.workspace.navigation",
              id: SECTION_ID,
              order: 110,
              label: () => labels().nav,
            },
            MemoryNavigation,
          ),
      );
      const disposeView = ready.slots.inject("amiba.workspace.view", () =>
        ready.slots.register(
          {
            name: "amiba.workspace.view",
            id: SECTION_ID,
            label: () => labels().nav,
            inject: () => ({
              adapter,
              startChat: (prompt: string) => ready.layout.openNewChat(prompt),
              expandSidebar: () => ready.layout.toggleSidebar(),
              openSettings: () => ready.layout.openSettings(SECTION_ID),
            }),
          },
          MemoryPage,
        ),
      );
      const getStatus = () => ready.remote.amibaMemory.status();
      const disposeSection = ready.slots.inject("settings.section", () =>
        ready.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            order: 300,
            label: () => labels().nav,
            inject: () => ({ navIcon: () => <Brain /> }),
          },
          () => <MemosPanel getStatus={getStatus} />,
        ),
      );
      const disposePresetSection = ready.slots.inject(
        "amiba.agentPreset.section",
        () =>
          ready.slots.register(
            {
              name: "amiba.agentPreset.section",
              id: SECTION_ID,
              order: 300,
              label: () => labels().nav,
            },
            () => <MemosPanel getStatus={getStatus} />,
          ),
      );
      return () => {
        disposeView();
        disposeNavigation();
        disposePresetSection();
        disposeSection();
      };
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
