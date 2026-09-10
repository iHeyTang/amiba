import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import { NavigationRow, usePluginT } from "@amiba/ui/plugin";
import { MemoryPage, type MemoryAdapter } from "./MemoryPage.js";
import { Brain } from "lucide-react";
import { AMIBA_MEMORY_REMOTE } from "../remote.js";
import { MemosPanel } from "./MemosPanel.js";

export const name = "amiba-memory-memos-ui";
export const inject = ["slots", "remote", "layout"];
const SECTION_ID = "memory";

function labels() {
  return {
    nav: document.documentElement.lang.startsWith("zh") ? "记忆" : "Memory",
  };
}

function MemoryNavigation({
  activeView,
  openWorkspace,
}: PropsRuntime<"amiba.workspace.navigation">) {
  const { language } = usePluginT();
  const label = language.startsWith("zh") ? "记忆" : "Memory";
  return (
    <NavigationRow
      active={activeView === SECTION_ID}
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
      // Keep the Viewer session in this client runtime only, never in host-global state or storage.
      let session: string | undefined;
      const adapter: MemoryAdapter = {
        async login(password) {
          const result = await remote.login(password);
          if (!result.ok) throw new Error(result.error.message);
          session = result.value;
        },
        async overview() {
          const result = await remote.overview(session);
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
        async browse(input) {
          const result = await remote.browse({ ...input, session });
          if (!result.ok) throw new Error(result.error.message);
          return result.value;
        },
      };
      const disposeNavigation = ready.slots.inject(
        "amiba.workspace.navigation",
        () =>
          ready.slots.register(
            {
              name: "amiba.workspace.navigation",
              id: SECTION_ID,
              order: -100,
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
