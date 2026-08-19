import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client";
import { resolveSlotLabel } from "@deepseek-ai/dsh-client-ui-slots";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { UserRound } from "lucide-react";
import { type ReactNode } from "react";

import { createAgentPresetsAdapter, type AgentPresetsAdapter } from "./data.js";
import {
  DshAgentPresetsPage,
  type PresetSectionRow,
  type SnapshotSource,
} from "./DshAgentPresetsPage.js";

export const name = "amiba-agent-preset-ui";
export const inject = ["slots", "remote", "connection"];

/**
 * Keeps the retired registry id so `#agents` deep links resolve through
 * SettingsView's `dsh:<id>` ledger fallback. The former sibling id
 * `behavior` is retired entirely (AP3 merged the 行为与人设 page into this
 * section as the pinned default-preset row); an old `#behavior` link still
 * resolves through the same generic fallback, it just finds no section.
 */
const SECTION_ID = "agents";

/** The retired registry entry's navTitle (`options.nav.agents`), verbatim. */
function sectionLabel(): string {
  return document.documentElement.lang.toLowerCase().startsWith("zh")
    ? "智能体预设"
    : "Agent presets";
}

type AgentPresetsSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: AgentPresetsAdapter;
  presetSections: SnapshotSource<readonly PresetSectionRow[]>;
  refreshSignal: SnapshotSource<number>;
};

function AgentPresetsSettings({
  adapter,
  headerActionsHost,
  presetSections,
  refreshSignal,
}: AgentPresetsSectionProps): ReactNode {
  return (
    <DshAgentPresetsPage
      adapter={adapter}
      headerActionsHost={headerActionsHost}
      presetSections={presetSections}
      refreshSignal={refreshSignal}
    />
  );
}

/**
 * Mount the ONE assistant-group settings section this plugin owns: 智能体预设
 * ("Agent presets") — the roster led by a pinned row for the current default
 * preset (read-only drill-in, the folded-in former 行为与人设 page) followed
 * by the independent presets with their full drill-in detail.
 *
 * Data plane: the engine-native agent-preset wire face on the connection
 * service (`api.agentPresets.*` + the `agent-presets` settings namespace) —
 * the exact surface the official `dsh-client-ui-agent-preset` row consumed
 * before Amiba disabled it — plus the forwarded `settings/document-updated`
 * host event for roster refreshes. No host platform adapter is involved.
 */
export function apply(ctx: ClientContext): void {
  const { api } = ctx.get("connection") as ConnectionHandle;
  const adapter = createAgentPresetsAdapter(api);

  ctx.effect(() => {
    // Live projection of the `amiba.agentPreset.section` ledger into the
    // detail tab strip (the ui-shell sections-source pattern: slot version
    // + document language double as the invalidation keys).
    let sectionsVersion = -1;
    let sectionsLanguage = "";
    let sections: readonly PresetSectionRow[] = [];
    const presetSections: SnapshotSource<readonly PresetSectionRow[]> = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("amiba.agentPreset.section");
        const language = document.documentElement.lang;
        if (version !== sectionsVersion || language !== sectionsLanguage) {
          sectionsVersion = version;
          sectionsLanguage = language;
          sections = ctx.slots
            .entriesOfSlot("amiba.agentPreset.section")
            .map((entry) => ({
              id: entry.options.id ?? "",
              label:
                resolveSlotLabel(entry.options.label) ?? entry.options.id ?? "",
              order: entry.options.order ?? 0,
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order)
            .map(({ id, label }) => ({ id, label }));
        }
        return sections;
      },
      subscribe: (listener: () => void) => {
        const disposeSlotSubscription = ctx.slots.subscribe(
          "amiba.agentPreset.section",
          listener,
        );
        const languageObserver = new MutationObserver(listener);
        languageObserver.observe(document.documentElement, {
          attributeFilter: ["lang"],
          attributes: true,
        });
        return () => {
          languageObserver.disconnect();
          disposeSlotSubscription();
        };
      },
    };

    // Roster refresh signal: another surface changing the default preset
    // moves the `agent-presets` settings document; the page re-reads quietly.
    let refreshVersion = 0;
    const refreshListeners = new Set<() => void>();
    const refreshSignal: SnapshotSource<number> = {
      getSnapshot: () => refreshVersion,
      subscribe: (listener) => {
        refreshListeners.add(listener);
        return () => {
          refreshListeners.delete(listener);
        };
      },
    };
    const disposeSettingsMoved = ctx.remote.$on(
      "settings/document-updated",
      (ns) => {
        if (ns !== "agent-presets") return;
        refreshVersion += 1;
        for (const listener of refreshListeners) listener();
      },
    );

    const disposeSection = ctx.slots.inject("amiba.settings.section", () =>
      ctx.slots.register(
        {
          name: "amiba.settings.section",
          id: SECTION_ID,
          // Leads the Assistant group, ahead of Models & services (50) —
          // the position the retired 行为与人设 section (5) held before it
          // merged into this page.
          order: 5,
          label: sectionLabel,
          inject: () => ({
            adapter,
            presetSections,
            refreshSignal,
            navIcon: () => <UserRound />,
          }),
        },
        AgentPresetsSettings,
      ),
    );

    return () => {
      disposeSection();
      disposeSettingsMoved();
    };
  }, "amiba-agent-preset: settings section and roster refresh");
}
