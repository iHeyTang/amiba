import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type {
  PropsRenderSlots,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { Wrench } from "lucide-react";
import { type ReactNode } from "react";

import { AMIBA_TOOLS_REMOTE } from "../remote.js";
import {
  DshAgentCapabilitiesPage,
  type ToolsDirectoryAdapter,
} from "./DshAgentCapabilitiesPage.js";

export const name = "amiba-tools-catalog-ui";
export const inject = ["slots", "remote"];

const SECTION_ID = "tools";
// Matches `SettingsAgentsPage`'s (now retired) hardcoded "capabilities" tab
// id, so this ledger registration seamlessly replaces it.
const PRESET_SECTION_ID = "capabilities";
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

function sectionLabel(): string {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "工具"
    : "Tools";
}

type ToolsSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: ToolsDirectoryAdapter;
} & PropsRenderSlots<"amiba.tools.panel">;

function ToolsSettings({
  adapter,
  chromeHeightPx,
  headerActionsHost,
  renderSlot,
}: ToolsSectionProps): ReactNode {
  return (
    <DshAgentCapabilitiesPage
      adapter={adapter}
      chromeHeightPx={chromeHeightPx}
      headerActionsHost={headerActionsHost}
    >
      {renderSlot("amiba.tools.panel", {
        chromeHeightPx,
      })}
    </DshAgentCapabilitiesPage>
  );
}

type ToolsPresetSectionProps = PropsRuntime<"amiba.agentPreset.section"> & {
  adapter: ToolsDirectoryAdapter;
};

/**
 * Preset-detail tab (M1 `amiba.agentPreset.section`): the same directory
 * view, embedded under an agent preset's detail tabs.
 *
 * Unlike memory (per-preset storage) or skills (per-session DSH
 * composition), the DSH runtime tool catalog is a single global inventory —
 * `amibaTools/list()` takes no session or preset argument at the RPC level.
 * `profileId` still arrives here (every `amiba.agentPreset.section`
 * registrant receives one, per the M1 contract) but is intentionally not
 * used to scope the query — this preserves the pre-migration host tab's own
 * behavior, where `AgentCapabilitiesPage`'s `profileId` prop was accepted
 * and never forwarded to the DSH adapter either. No `amiba.tools.panel`
 * children are rendered here: that slot is scoped to the single top-level
 * Tools settings section, not per-preset.
 */
function ToolsPresetSection({ adapter }: ToolsPresetSectionProps): ReactNode {
  return <DshAgentCapabilitiesPage adapter={adapter} embedded />;
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
      const adapter: ToolsDirectoryAdapter = {
        async list() {
          const result = await remote.list();
          if (!result.ok) throw errorOf(result.error);
          return result.value;
        },
      };
      const disposeSection = injectedCtx.slots.inject(
        "amiba.settings.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.settings.section",
              id: SECTION_ID,
              order: 100,
              children: {
                "amiba.tools.panel": { kind: "list", scope: "root" },
              },
              label: sectionLabel,
              inject: () => ({ adapter, navIcon: () => <Wrench /> }),
            },
            ToolsSettings,
          ),
      );
      const disposePresetSection = injectedCtx.slots.inject(
        "amiba.agentPreset.section",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.agentPreset.section",
              id: PRESET_SECTION_ID,
              order: 250,
              label: sectionLabel,
              inject: () => ({ adapter }),
            },
            ToolsPresetSection,
          ),
      );
      return () => {
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
