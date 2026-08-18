import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import {
  DshApiClient,
  createWebPlatformAdapter,
} from "@amiba/app-runtime/dsh-client";
import { hasPlatform, setPlatform } from "@amiba/app-runtime/platform";
import { loadLanguagePreference, resolveLanguage } from "@amiba/i18n";
import {
  resolveSlotLabel,
  type PropsRenderSlots,
  type PropsRuntime,
  type SnapshotSelectorHook,
} from "@deepseek-ai/dsh-client-ui-slots";
import {
  AMIBA_ROOT_SLOTS,
  type AmibaAgentPresetSectionOwner,
  type AmibaRootSlot,
  type AmibaSettingsNavigationOwner,
  type AmibaSettingsSectionOwner,
  type AmibaWorkspaceNavigationOwner,
  type AmibaWorkspaceViewOwner,
} from "@amiba/extension-sdk";
import { NavigationRow } from "@amiba/ui/plugin";
import { Blocks } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  AmibaProductShell,
  SETTINGS_SECTION_HEADER_ACTIONS_HOST_PROP,
  type SlotMarkerElement,
} from "./product-shell.js";
import shellCss from "./styles.css?inline";

export const name = "amiba-ui-shell";
export const inject = ["slots"];

const PACKAGE_ID = "@amiba/dsh-plugin-ui-shell";
const STYLE_ID = `${PACKAGE_ID}/product-shell.css`;
if (
  typeof document !== "undefined" &&
  document.querySelector(
    `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`,
  ) === null
) {
  const tag = document.createElement("style");
  tag.dataset.plugin = PACKAGE_ID;
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = shellCss;
  document.head.append(tag);
}

export type {
  AmibaAgentPresetSectionOwner,
  AmibaRootSlot,
  AmibaSettingsNavigationOwner,
  AmibaSettingsSectionOwner,
  AmibaWorkspaceNavigationOwner,
  AmibaWorkspaceViewOwner,
} from "@amiba/extension-sdk";

type AmibaRootProps = PropsRuntime<"root"> &
  PropsRenderSlots<AmibaRootSlot> & { shell: ReactNode };

const ROOT_READY_EVENT = "amiba:dsh-root-ready";
const SLOT_NAMES: readonly AmibaRootSlot[] = AMIBA_ROOT_SLOTS;

interface SlotTarget {
  element: Element;
  filterId?: string;
  name: AmibaRootSlot;
  owner: AmibaSettingsSectionOwner &
    AmibaSettingsNavigationOwner &
    AmibaWorkspaceNavigationOwner &
    AmibaWorkspaceViewOwner &
    Partial<AmibaAgentPresetSectionOwner>;
}

function isRootSlot(value: string): value is AmibaRootSlot {
  return (SLOT_NAMES as readonly string[]).includes(value);
}

function findSlotTargets(): Map<string, SlotTarget> {
  const targets = new Map<string, SlotTarget>();
  for (const element of document.querySelectorAll("[data-amiba-dsh-slot]")) {
    const name = element.getAttribute("data-amiba-dsh-slot") ?? "";
    if (!isRootSlot(name)) continue;
    const filterId =
      element.getAttribute("data-amiba-dsh-slot-only")?.trim() || undefined;
    if (
      (name === "amiba.settings.section" ||
        name === "amiba.workspace.view" ||
        name === "amiba.agentPreset.section") &&
      !filterId
    )
      continue;
    const rawChromeHeight = element.getAttribute(
      "data-amiba-dsh-chrome-height",
    );
    const parsedChromeHeight = rawChromeHeight
      ? Number.parseInt(rawChromeHeight, 10)
      : Number.NaN;
    const rawTopBarLeftInset = element.getAttribute(
      "data-amiba-dsh-top-bar-left-inset",
    );
    const parsedTopBarLeftInset = rawTopBarLeftInset
      ? Number.parseInt(rawTopBarLeftInset, 10)
      : Number.NaN;
    const rawActiveView = element
      .getAttribute("data-amiba-dsh-active-view")
      ?.trim();
    const rawActiveSection = element
      .getAttribute("data-amiba-dsh-active-section")
      ?.trim();
    const rawProfileId = element
      .getAttribute("data-amiba-dsh-profile-id")
      ?.trim();
    const headerActionsHost = (element as SlotMarkerElement)[
      SETTINGS_SECTION_HEADER_ACTIONS_HOST_PROP
    ];
    const owner: SlotTarget["owner"] = {
      ...(Number.isFinite(parsedChromeHeight)
        ? { chromeHeightPx: parsedChromeHeight }
        : {}),
      ...(headerActionsHost ? { headerActionsHost } : {}),
      ...(Number.isFinite(parsedTopBarLeftInset)
        ? { topBarLeftInset: parsedTopBarLeftInset }
        : {}),
      ...(rawActiveView ? { activeView: rawActiveView } : {}),
      ...(rawActiveSection ? { activeSection: rawActiveSection } : {}),
      ...(rawProfileId ? { profileId: rawProfileId } : {}),
      ...(element.hasAttribute("data-amiba-dsh-sidebar-collapsed")
        ? {
            sidebarCollapsed:
              element.getAttribute("data-amiba-dsh-sidebar-collapsed") ===
              "true",
          }
        : {}),
      ...(element.hasAttribute("data-amiba-dsh-show-sidebar-expand")
        ? {
            showSidebarExpandControl:
              element.getAttribute("data-amiba-dsh-show-sidebar-expand") ===
              "true",
          }
        : {}),
    };
    const id = filterId ? `${name}:${filterId}` : name;
    targets.set(id, { element, filterId, name, owner });
  }
  return targets;
}

function sameTargets(
  left: ReadonlyMap<string, SlotTarget>,
  right: ReadonlyMap<string, SlotTarget>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, target] of left) {
    const candidate = right.get(id);
    if (
      candidate?.element !== target.element ||
      candidate.filterId !== target.filterId ||
      candidate.owner.chromeHeightPx !== target.owner.chromeHeightPx ||
      candidate.owner.topBarLeftInset !== target.owner.topBarLeftInset ||
      candidate.owner.activeView !== target.owner.activeView ||
      candidate.owner.activeSection !== target.owner.activeSection ||
      candidate.owner.sidebarCollapsed !== target.owner.sidebarCollapsed ||
      candidate.owner.showSidebarExpandControl !==
        target.owner.showSidebarExpandControl ||
      candidate.owner.profileId !== target.owner.profileId
    ) {
      return false;
    }
  }
  return true;
}

function AmibaRoot({ renderSlot, shell }: AmibaRootProps): ReactNode {
  const [targets, setTargets] = useState<ReadonlyMap<string, SlotTarget>>(
    () => new Map(),
  );

  useEffect(() => {
    const scan = () => {
      const next = findSlotTargets();
      setTargets((current) => (sameTargets(current, next) ? current : next));
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      attributeFilter: [
        "data-amiba-dsh-slot",
        "data-amiba-dsh-slot-only",
        "data-amiba-dsh-chrome-height",
        "data-amiba-dsh-top-bar-left-inset",
        "data-amiba-dsh-active-view",
        "data-amiba-dsh-active-section",
        "data-amiba-dsh-sidebar-collapsed",
        "data-amiba-dsh-show-sidebar-expand",
        "data-amiba-dsh-profile-id",
      ],
      attributes: true,
      childList: true,
      subtree: true,
    });
    scan();
    window.dispatchEvent(new CustomEvent(ROOT_READY_EVENT));
    return () => observer.disconnect();
  }, []);

  const portals = useMemo(
    () =>
      [...targets.entries()].map(([id, target]) =>
        createPortal(
          (target.name === "amiba.settings.section" ||
            target.name === "amiba.workspace.view" ||
            target.name === "amiba.agentPreset.section") &&
            target.filterId
            ? renderSlot(target.name, target.owner, {
                only: target.filterId,
              })
            : renderSlot(target.name, target.owner),
          target.element,
          `amiba-dsh-slot:${id}`,
        ),
      ),
    [renderSlot, targets],
  );

  return (
    <>
      {shell}
      {portals}
    </>
  );
}

export interface AmibaLayoutService {
  toggleSidebar(): void;
  openDetails(): void;
  closeDetails(): void;
  openChat(): void;
  openWorkspace(viewId: string): void;
  openSettings(sectionId?: string): void;
}

interface SettingsSectionRow {
  id: string;
  label: string;
  order: number;
}

type SettingsSectionNavigationProps =
  PropsRuntime<"amiba.settings.navigation.assistant"> & {
    openSettings(sectionId: string): void;
    useSections: SnapshotSelectorHook<readonly SettingsSectionRow[]>;
  };

/**
 * Project the DSH section ledger into Amiba's existing Settings navigation.
 * Feature plugins register exactly one section entry; Electron never imports
 * or enumerates them.
 */
function SettingsSectionNavigation({
  activeSection,
  openSettings,
  useSections,
}: SettingsSectionNavigationProps): ReactNode {
  const sections = useSections((snapshot) => snapshot);
  return sections.map((section) => (
    <NavigationRow
      active={activeSection === section.id}
      icon={<Blocks />}
      key={section.id}
      label={section.label}
      onClick={() => openSettings(section.id)}
    />
  ));
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    layout: AmibaLayoutService;
  }
}

function dispatchLayoutAction(
  action: string,
  detail: Record<string, unknown> = {},
): void {
  window.dispatchEvent(
    new CustomEvent("amiba:dsh-layout-action", {
      detail: { action, ...detail },
    }),
  );
}

/** Register Amiba as the one DSH root owner and declare its child authority. */
export async function apply(ctx: ClientContext): Promise<void> {
  const baseUrl =
    window.location.protocol === "file:"
      ? "http://dsh.internal"
      : window.location.origin;
  const dshClient = new DshApiClient({ baseUrl });
  if (!hasPlatform()) setPlatform(createWebPlatformAdapter(dshClient));
  document.documentElement.lang = resolveLanguage(
    await loadLanguagePreference(),
  );
  document.title = "Amiba";
  const layout: AmibaLayoutService = {
    toggleSidebar: () => dispatchLayoutAction("toggle-sidebar"),
    openDetails: () => dispatchLayoutAction("open-details"),
    closeDetails: () => dispatchLayoutAction("close-details"),
    openChat: () => dispatchLayoutAction("open-chat"),
    openWorkspace: (viewId) =>
      dispatchLayoutAction("open-workspace", { viewId }),
    openSettings: (sectionId) =>
      dispatchLayoutAction("open-settings", { sectionId }),
  };

  ctx.effect(() => {
    let sectionsVersion = -1;
    let sectionsLanguage = "";
    let sections: readonly SettingsSectionRow[] = [];
    const sectionsSource = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("amiba.settings.section");
        const language = document.documentElement.lang;
        if (version !== sectionsVersion || language !== sectionsLanguage) {
          sectionsVersion = version;
          sectionsLanguage = language;
          sections = ctx.slots
            .entriesOfSlot("amiba.settings.section")
            .map((entry) => ({
              id: entry.options.id ?? "",
              label:
                resolveSlotLabel(entry.options.label) ?? entry.options.id ?? "",
              order: entry.options.order ?? 0,
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order);
        }
        return sections;
      },
      subscribe: (listener: () => void) => {
        const disposeSlotSubscription = ctx.slots.subscribe(
          "amiba.settings.section",
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
    let presetSectionsVersion = -1;
    let presetSectionsLanguage = "";
    let presetSections: readonly SettingsSectionRow[] = [];
    const presetSectionsSource = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("amiba.agentPreset.section");
        const language = document.documentElement.lang;
        if (
          version !== presetSectionsVersion ||
          language !== presetSectionsLanguage
        ) {
          presetSectionsVersion = version;
          presetSectionsLanguage = language;
          presetSections = ctx.slots
            .entriesOfSlot("amiba.agentPreset.section")
            .map((entry) => ({
              id: entry.options.id ?? "",
              label:
                resolveSlotLabel(entry.options.label) ?? entry.options.id ?? "",
              order: entry.options.order ?? 0,
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order);
        }
        return presetSections;
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
    const disposeLayout = ctx.reflect.provide("layout", layout);
    const disposeRoot = ctx.slots.register(
      {
        name: "root",
        inject: () => ({
          shell: (
            <AmibaProductShell
              dshClient={dshClient}
              settingsSections={sectionsSource}
              presetSections={presetSectionsSource}
            />
          ),
        }),
        children: {
          "amiba.navigation.before": { kind: "list", scope: "root" },
          "amiba.navigation.after": { kind: "list", scope: "root" },
          "amiba.workspace.navigation": {
            kind: "list",
            scope: "root",
            inject: {
              openWorkspace: (viewId: string) => layout.openWorkspace(viewId),
            },
          },
          "amiba.workspace.view": { kind: "list", scope: "root" },
          "amiba.chat.header.after": { kind: "list", scope: "root" },
          "amiba.chat.content.overlay": { kind: "list", scope: "root" },
          "amiba.settings.navigation.before": {
            kind: "list",
            scope: "root",
          },
          "amiba.settings.navigation.assistant": {
            kind: "single",
            scope: "root",
          },
          "amiba.settings.navigation.after": {
            kind: "list",
            scope: "root",
          },
          "amiba.settings.section": {
            kind: "list",
            scope: "root",
          },
          "amiba.settings.content.overlay": {
            kind: "list",
            scope: "root",
          },
          "amiba.agentPreset.section": {
            kind: "list",
            scope: "root",
          },
          "amiba.shell.overlay": { kind: "list", scope: "root" },
        },
      },
      AmibaRoot,
    );
    const disposeSettingsNavigation = ctx.slots.inject(
      "amiba.settings.navigation.assistant",
      () =>
        ctx.slots.register(
          {
            name: "amiba.settings.navigation.assistant",
            inject: () => ({
              hooks: { sections: sectionsSource },
              openSettings: (sectionId: string) =>
                layout.openSettings(sectionId),
            }),
          },
          SettingsSectionNavigation,
        ),
    );
    return () => {
      disposeSettingsNavigation();
      disposeRoot();
      void disposeLayout();
    };
  }, "amiba-ui-shell: root and semantic child slots");
}
