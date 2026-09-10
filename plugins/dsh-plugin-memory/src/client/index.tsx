import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Brain } from "lucide-react";
import { AMIBA_MEMORY_REMOTE } from "../remote.js";
import { MemosPanel } from "./MemosPanel.js";

export const name = "amiba-memory-ui";
export const inject = ["slots", "remote"];
const SECTION_ID = "memory";

function labels() {
  return {
    nav: document.documentElement.lang.startsWith("zh") ? "记忆" : "Memory",
  };
}

/** Both shell extension points host the current MemOS manager. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MEMORY_REMOTE);
  const sectionFiber = ctx.inject(["slots", "remote.amibaMemory"], (ready) => {
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
      disposePresetSection();
      disposeSection();
    };
  });
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
