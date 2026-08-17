import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  PropsRenderSlots,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { ToolsDirectoryView } from "@amiba/ui/plugin/tools";
import { type ReactNode } from "react";

import type { ToolInventory } from "../remote.js";
import { AMIBA_TOOLS_REMOTE } from "../remote.js";

export const name = "amiba-tools-catalog-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "tools";
type ToolsRemote = ClientContext["remote"]["amibaTools"];

export interface AmibaToolsPanelOwner {
  chromeHeightPx?: number;
}

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    /** Feature-owned children rendered inside the Tools settings section. */
    "amiba.tools.panel": {
      kind: "list";
      scope: "root";
      owner: AmibaToolsPanelOwner;
    };
  }
}

type ToolsSectionProps = PropsRuntime<"amiba.settings.section"> & {
  listTools(): Promise<ToolInventory>;
} & PropsRenderSlots<"amiba.tools.panel">;

function ToolsSettings({
  chromeHeightPx,
  headerActionsHost,
  listTools,
  renderSlot,
}: ToolsSectionProps): ReactNode {
  return (
    <ToolsDirectoryView
      adapter={{ list: listTools }}
      chromeHeightPx={chromeHeightPx}
      headerActionsHost={headerActionsHost}
    >
      {renderSlot("amiba.tools.panel", {
        chromeHeightPx,
      })}
    </ToolsDirectoryView>
  );
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_TOOLS_REMOTE);
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaTools"],
    (injectedCtx) => {
      const remote: ToolsRemote = injectedCtx.remote.amibaTools;
      const listTools = async () => {
        const result = await remote.list();
        if (!result.ok) throw errorOf(result.error);
        return result.value;
      };
      return injectedCtx.slots.inject("amiba.settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.settings.section",
            id: SECTION_ID,
            order: 100,
            children: {
              "amiba.tools.panel": { kind: "list", scope: "root" },
            },
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "工具"
                : "Tools",
            inject: () => ({ listTools }),
          },
          ToolsSettings,
        ),
      );
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
