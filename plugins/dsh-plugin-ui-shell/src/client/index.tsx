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
} from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, type ReactNode } from "react";

import {
  AmibaProductShell,
  type AmibaShellSlot,
  type SettingsSectionsSource,
} from "./product-shell.js";
import {
  createSessionsBridge,
  type AmibaSessionsBridge,
} from "./sessions-bridge.js";
import shellCss from "./styles.css?inline";

export const name = "amiba-ui-shell";
export const inject = ["slots", "sessions"];

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
  AmibaComposerModelPickerOwner,
  AmibaComposerModelSelection,
  AmibaRootSlot,
  AmibaWorkspaceNavigationOwner,
  AmibaWorkspaceViewOwner,
  // Official owner contracts inherited through the SDK: settings.section
  // ({ close }) from dsh-client-ui-settings; the four conversation seats
  // (header utilities and header actions: empty owner; input.model and
  // input.plan: { locked }) from dsh-client-ui-conversation.
  ConversationHeaderActionsOwnerProps,
  ConversationHeaderUtilitiesOwnerProps,
  ConversationInputModelOwnerProps,
  ConversationInputPlanOwnerProps,
  SettingsSectionOwnerProps,
} from "@amiba/extension-sdk";

type AmibaRootProps = PropsRuntime<"root"> &
  PropsRenderSlots<AmibaShellSlot> & {
    dshClient: DshApiClient;
    settingsSections: SettingsSectionsSource;
    openSettingsSection: (sectionId: string) => void;
    sessionsBridge: AmibaSessionsBridge;
  };

const ROOT_READY_EVENT = "amiba:dsh-root-ready";

/**
 * The one component registered into the official DSH `root` slot. It
 * constructs the whole product shell and hands `renderSlot` down as render
 * props — every plugin contribution renders in this one React tree through
 * the official dispatch. No DOM marker scanning, no portals: the former
 * data-amiba-dsh-* side-channel is gone (the only surviving data-amiba-dsh-*
 * attribute is `data-amiba-dsh-base-url`, a different contract owned by the
 * desktop renderer bootstrap).
 */
function AmibaRoot({
  renderSlot,
  dshClient,
  settingsSections,
  openSettingsSection,
  sessionsBridge,
}: AmibaRootProps): ReactNode {
  useEffect(() => {
    // Boot handshake: the desktop renderer waits for this (or for the
    // [data-amiba-product-shell] node) before flushing queued deep links.
    window.dispatchEvent(new CustomEvent(ROOT_READY_EVENT));
  }, []);

  return (
    <AmibaProductShell
      dshClient={dshClient}
      openSettingsSection={openSettingsSection}
      renderSlot={renderSlot}
      sessionsBridge={sessionsBridge}
      settingsSections={settingsSections}
    />
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
 * fall back to the generic Blocks glyph. Official plugins registering into
 * `settings.section` simply carry no icon and get the fallback.
 */
function resolveSectionNavIcon(
  inject: ((...args: never[]) => Record<string, unknown>) | undefined,
): ReactNode {
  const navIcon = inject?.().navIcon;
  return typeof navIcon === "function"
    ? ((navIcon as () => ReactNode)() ?? undefined)
    : undefined;
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
        const version = ctx.slots.getVersion("settings.section");
        const language = document.documentElement.lang;
        if (version !== sectionsVersion || language !== sectionsLanguage) {
          sectionsVersion = version;
          sectionsLanguage = language;
          sections = ctx.slots
            .entriesOfSlot("settings.section")
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
          "settings.section",
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
    // R1 selection bridge: keep the official ctx.sessions selection (the
    // session resolution every official session-scoped slot renders under)
    // in lock-step with Amiba's own per-window sessions store. The official
    // side's external switches route through the existing Amiba
    // open-session path.
    const sessionsBridge = createSessionsBridge(ctx.sessions, (sessionId) => {
      window.dispatchEvent(
        new CustomEvent("amiba:open-session", { detail: { sessionId } }),
      );
    });
    const disposeRoot = ctx.slots.register(
      {
        name: "root",
        // Data faces only — AmibaRoot itself constructs the product shell,
        // so the one component receiving `renderSlot` is also the one that
        // hands render props down into it. The product shell renders the
        // section-ledger navigation directly (no slot indirection), so the
        // nav's openSettings affordance rides this face too.
        inject: () => ({
          dshClient,
          settingsSections: sectionsSource,
          openSettingsSection: (sectionId: string) =>
            layout.openSettings(sectionId),
          sessionsBridge,
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
          // Official vocabulary: the right-aligned session-header utilities
          // strip, from @deepseek-ai/dsh-client-ui-conversation (replaces
          // the retired amiba.chat.header.after). SESSION scope from a
          // root-scoped parent is legal: neither ChildrenDecl nor the
          // runtime constrains a child's scope to its declarer's — the
          // scope axis only selects which standard kit the ENTRY's
          // components receive, and the renderer's StrictSessionEntry
          // renders null while no official session is current, so the home
          // view is unaffected.
          "conversation.session.header.utilities": {
            kind: "list",
            scope: "session",
          },
          // Official vocabulary: the TITLE-ADJACENT per-session action row
          // (list, session scope, EMPTY owner — the contract is explicit
          // that an action derives sessionId and everything else from the
          // standard session kit and its own inject face). A separate seat
          // from the utilities strip above, exactly as upstream splits
          // them, so an optional utility cannot reorder session context.
          // Amiba had no such region before P3; the chat content header
          // grew one that collapses to nothing while the seat is empty.
          "conversation.session.header.actions": {
            kind: "list",
            scope: "session",
          },
          "amiba.chat.content.overlay": { kind: "list", scope: "root" },
          // The session-less hero model seat (vendor) and its official
          // session-scoped counterpart: the composer dispatches
          // conversation.input.model while it has a session id, the hero
          // seat otherwise. Same root-declares-session-child shape as the
          // header utilities above.
          "amiba.composer.modelPicker": { kind: "list", scope: "root" },
          "conversation.input.model": { kind: "single", scope: "session" },
          // Official vocabulary: the named plan-status seat in the composer
          // tool row, immediately right of the access-mode control (single,
          // session scope, owner InputControlOwnerProps { locked } — the
          // same owner share as the model seat). No occupant today: the
          // official ui-plan package is disabled, so the seat renders
          // nothing until a plugin takes it, which is exactly the contract
          // ("unoccupied, the seat renders nothing at all").
          "conversation.input.plan": { kind: "single", scope: "session" },
          // Official vocabulary: the settings-page ledger seat, inherited
          // from @deepseek-ai/dsh-client-ui-settings (owner: { close }).
          "settings.section": {
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
          // Official vocabulary: the frame-wide click-through floating
          // layer, from @deepseek-ai/dsh-client-ui-layout.
          "shell.overlay": { kind: "list", scope: "root" },
        },
      },
      AmibaRoot,
    );
    return () => {
      disposeRoot();
      sessionsBridge.dispose();
      void disposeLayout();
    };
  }, "amiba-ui-shell: root and semantic child slots");
}
