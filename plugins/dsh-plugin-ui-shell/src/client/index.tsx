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
  AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP,
  AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR,
  type AmibaComposerModelPickerOwner,
  type AmibaComposerModelPickerPropsGetter,
} from "@amiba/extension-sdk";
import { NavigationRow } from "@amiba/ui/plugin";
import { Blocks } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  AmibaProductShell,
  type AmibaShellSlot,
  type SettingsSectionsSource,
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
  AmibaComposerAgentModels,
  AmibaComposerModelPickerOwner,
  AmibaComposerModelSelection,
  AmibaRootSlot,
  AmibaSettingsNavigationOwner,
  AmibaSettingsSectionOwner,
  AmibaWorkspaceNavigationOwner,
  AmibaWorkspaceViewOwner,
} from "@amiba/extension-sdk";

type AmibaRootProps = PropsRuntime<"root"> &
  PropsRenderSlots<AmibaShellSlot> & {
    dshClient: DshApiClient;
    settingsSections: SettingsSectionsSource;
  };

const ROOT_READY_EVENT = "amiba:dsh-root-ready";
const COMPOSER_PICKER_SLOT = "amiba.composer.modelPicker";

/**
 * The one remaining marker/portal channel: the composer's model-picker hole.
 * Every other surface receives its contribution through renderSlot-backed
 * render props; the composer marker survives only until the picker rides a
 * render prop too (Phase 0 step: composer conversion).
 */
interface ComposerPickerTarget {
  element: Element;
  /**
   * Serialized subset of the marker's rich props. Rich props travel by
   * element property, which MutationObserver cannot watch; this attribute
   * string is their change signal, compared in {@link samePickerTargets} so
   * a draft-selection change re-renders the portal.
   */
  stateFingerprint?: string;
  owner: AmibaComposerModelPickerOwner;
}

/** Marker node carrying the composer model picker's rich-props getter. */
type ComposerPickerMarkerElement = Element & {
  [AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP]?: AmibaComposerModelPickerPropsGetter;
};

function findComposerPickerTargets(): Map<string, ComposerPickerTarget> {
  const targets = new Map<string, ComposerPickerTarget>();
  for (const element of document.querySelectorAll(
    `[data-amiba-dsh-slot="${COMPOSER_PICKER_SLOT}"]`,
  )) {
    const owner = (element as ComposerPickerMarkerElement)[
      AMIBA_COMPOSER_MODEL_PICKER_PROPS_PROP
    ]?.();
    if (!owner) continue;
    const instanceId =
      element.getAttribute("data-amiba-dsh-slot-instance")?.trim() || undefined;
    const stateFingerprint =
      element.getAttribute(AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR) ?? undefined;
    const id = instanceId
      ? `${COMPOSER_PICKER_SLOT}@${instanceId}`
      : COMPOSER_PICKER_SLOT;
    targets.set(id, { element, owner, stateFingerprint });
  }
  return targets;
}

function samePickerTargets(
  left: ReadonlyMap<string, ComposerPickerTarget>,
  right: ReadonlyMap<string, ComposerPickerTarget>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [id, target] of left) {
    const candidate = right.get(id);
    if (
      candidate?.element !== target.element ||
      candidate.stateFingerprint !== target.stateFingerprint
    ) {
      return false;
    }
  }
  return true;
}

function AmibaRoot({
  renderSlot,
  dshClient,
  settingsSections,
}: AmibaRootProps): ReactNode {
  const [targets, setTargets] = useState<
    ReadonlyMap<string, ComposerPickerTarget>
  >(() => new Map());

  useEffect(() => {
    const scan = () => {
      const next = findComposerPickerTargets();
      setTargets((current) =>
        samePickerTargets(current, next) ? current : next,
      );
    };
    const observer = new MutationObserver(scan);
    observer.observe(document.documentElement, {
      attributeFilter: [
        "data-amiba-dsh-slot",
        "data-amiba-dsh-slot-instance",
        AMIBA_COMPOSER_MODEL_PICKER_STATE_ATTR,
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
          renderSlot(COMPOSER_PICKER_SLOT, target.owner),
          target.element,
          `amiba-dsh-slot:${id}`,
        ),
      ),
    [renderSlot, targets],
  );

  return (
    <>
      <AmibaProductShell
        dshClient={dshClient}
        renderSlot={renderSlot}
        settingsSections={settingsSections}
      />
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
  icon?: ReactNode;
}

/**
 * Amiba convention on top of the closed upstream slot-options shape: a
 * section's `inject` face may carry `navIcon` (a thunk returning the nav
 * glyph). The registration options type cannot grow an icon field, so the
 * ledger reads it from the business face instead; sections without one
 * fall back to the generic Blocks glyph.
 */
function resolveSectionNavIcon(
  inject: ((...args: never[]) => Record<string, unknown>) | undefined,
): ReactNode {
  const navIcon = inject?.().navIcon;
  return typeof navIcon === "function"
    ? ((navIcon as () => ReactNode)() ?? undefined)
    : undefined;
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
      icon={section.icon ?? <Blocks />}
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
              icon: resolveSectionNavIcon(entry.inject),
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
    const disposeLayout = ctx.reflect.provide("layout", layout);
    const disposeRoot = ctx.slots.register(
      {
        name: "root",
        // Data faces only — AmibaRoot itself constructs the product shell,
        // so the one component receiving `renderSlot` is also the one that
        // hands render props down into it.
        inject: () => ({
          dshClient,
          settingsSections: sectionsSource,
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
          "amiba.composer.modelPicker": { kind: "list", scope: "root" },
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
          // amiba.agentPreset.section is deliberately NOT declared here:
          // dsh-plugin-agent-preset declares it as a child of its own
          // settings-section entry (the amiba.tools.panel pattern).
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
