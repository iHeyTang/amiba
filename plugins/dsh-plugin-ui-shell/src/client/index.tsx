import { registerDocumentPreview } from './document-preview/register.js';
export type { ISidebarRight, SidebarRightOpenResourceOptions, SidebarRightOpenTabOptions } from './sidebar-right/service.js';
import { registerSidebarRight } from './sidebar-right/register.js';
import { createFileResourceProvider } from "./resources/file-provider.js";
export { sessionFileAddress, absoluteFileAddress, parseFileAddress, type FileAddress } from "./resources/file-address.js";
import { ResourceRegistry } from "./resources/resources.js";
export type { Resources, ResourceProtocol, ResourceProvider, ResourceSnapshot, ResourceStatus, ResourceOpenContext, UseResource } from "./resources/contract.js";
import { SidebarRightTabRegistry } from "./sidebar-right/tab-registry.js";
export type { SidebarRightTabDefinition, SidebarRightTabPriority, SidebarRightTabClaim } from "./sidebar-right/tab-registry.js";
import { createMainPanelListSource, type MainPanelRow } from "./main-panel-list.js";
import { MainPanelNavigation } from "./main-panel-navigation.js";
import { LayoutNavigation } from "./layout-navigation.js";
import { sessionComposerDraft, makeWorkspaceFilesProvider } from "@amiba/ui";
import { sessionPendingQueue } from "@amiba/ui/composer-runtime";
import { createInputActionsProvider } from "./input-actions-provider.js";
import { createDraftImageRegistry } from "./draft-image-registry.js";
import { registerConversationNodes } from "@deepseek-ai/dsh-client-ui-conversation/headless";
import { createDirectoryFlow, type DirectoryFlow } from "./directory-flow.js";
import { createConversationViewSource, type ConversationViewEntry } from "./conversation-view-source.js";
import { CONVERSATION_ENTRY_REMOTE } from "../conversation-remote.js";
import { createConversationPreparer } from "./conversation-submit.js";
import { ConversationSubmitProvider } from "@amiba/ui/plugin";
// Share the public plugin UI through the existing shell module identity.
// Consumers retain their source imports; Vite maps the external to this factory.
export * from "@amiba/ui/plugin";
import { createSurfaceSelections, type SurfaceSelections } from "./surface-selections.js";
import { SurfaceSettings } from "./surface-settings.js";
export { usePresentationCoordinator, useSurfaceActivity, useSurfaceInteraction } from "@amiba/ui/plugin";
export * from "streamdown";
export { WorkspaceFileWorkspace, CodeEditor, PreviewHeader, useWorkspacePane, WorkbenchViewBoundary } from "@amiba/ui/plugin";
export { cn } from "@amiba/ui/plugin";
export { getPlatform } from "@amiba/app-runtime/platform";
export { createSlotContributionsSource } from "./session-list-sources.js";
import { WorkbenchExtensionsProvider, builtinWorkbenchViews } from "@amiba/ui/plugin";
import type { WorkbenchViewExtension } from "@amiba/extension-sdk";
import { createWorkbenchSource } from "./workbench-source.js";
import type { NoticeReference } from "@amiba/app-runtime/protocol";
import { MARKDOWN_REMOTE } from "../markdown-remote.js";
import { createMarkdownReporter } from "./markdown-reporter.js";
import { MarkdownProvider, type MarkdownExtension, type MarkdownCapabilities } from "@amiba/markdown";
import { useSyncExternalStore } from "react";
import { createMarkdownSource } from "./markdown-source.js";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import { mountSessionExportChrome } from "./session-export.js";
import {
  DshApiClient,
  createWebPlatformAdapter,
} from "@amiba/app-runtime/dsh-client";
import { getPlatform, hasPlatform, setPlatform } from "@amiba/app-runtime/platform";
import { seedDocumentLanguage } from "@amiba/i18n";
/** Read shell-owned geometry without embedding a second platform singleton in consumers. */
export function settingsChromeHeightPx(): number | undefined {
  return getPlatform().kind === "desktop" ? (getPlatform().windowChrome?.topBarHeightPx ?? 40) : undefined;
}
import {
  resolveSlotLabel,
  type PropsRenderSlots,
  type PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import { useEffect, type ReactNode } from "react";

import {
  AmibaProductShell,
  type AmibaShellSlot,
  type OnboardingStepRow,
  type SettingsOnboardingStepsSource,
  type SettingsSectionsSource,
} from "./product-shell.js";
import {
  createSessionsBridge,
  type AmibaSessionsBridge,
} from "./sessions-bridge.js";
import {
  createInputTriggerBridge,
  type AmibaInputTriggerBridge,
} from "./input-trigger-bridge.js";
import {
  createSessionVisibility,
  type AmibaSessionVisibility,
  type HiddenSessionsSource,
} from "./session-visibility.js";
import {
  createSessionGroupsSource,
  createSessionMenuItemsSource,
  type ContributionsSource,
  type SessionGroupRow,
  type SessionMenuItemRow,
} from "./session-list-sources.js";
import {
  createMessageSourcesSource,
  type MessageSourceRow,
} from "./message-source.js";
import {
  connectOfficialLocale,
} from "./locale-bridge.js";
import {
  installAmibaMessageCatalog,
  registerAmibaMessages,
} from "./messages.js";
import {
  AmibaCommandPopupSeat,
  AmibaSlashMenuSeat,
  COMMAND_POPUP_ENTRY_ID,
  SHADOW_PRIORITY,
  SLASH_MENU_ENTRY_ID,
} from "./trigger-seats.js";
import {
  AmibaLanguageRow,
  LANGUAGE_ROW_ENTRY_ID,
  LANGUAGE_ROW_SHADOW_PRIORITY,
} from "./language-seat.js";
import {
  TRIGGER_SOURCE_LABELS,
  officialTriggerSources,
  type SessionListItemTarget,
} from "@amiba/ui";
import { AskUserQuestionToolview } from "./ask-toolview.js";
import { OFFICIAL_TOOLVIEWS } from "./official-toolviews.js";
import shellCss from "./styles.css?inline";

export const name = "amiba-ui-shell";
export const inject = ["slots", "sessions", "remote"];

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
  // input.plan: { locked }) from dsh-client-ui-conversation; and
  // conversation.input.overlay (empty owner) from
  // dsh-client-ui-input-trigger.
  ConversationHeaderActionsOwnerProps,
  ConversationHeaderUtilitiesOwnerProps,
  ConversationInputModelOwnerProps,
  ConversationInputOverlayOwnerProps,
  ConversationInputPlanOwnerProps,
  SettingsSectionOwnerProps,
} from "@amiba/extension-sdk";
export type { AmibaSessionVisibility, HiddenSessionsSource } from "./session-visibility.js";
export type { SessionListItemTarget } from "@amiba/ui";
/**
 * The `inject` business face of one `amiba.sessions.list.group`
 * registration: `ctx.slots.register({ name: "amiba.sessions.list.group",
 * id, order, label, inject: () => ({ claim }) }, NoopComponent)`.
 * `claim(session)` reports whether this group takes ownership of a session —
 * a claimed session is pulled out of the sidebar history list's normal
 * channel/date sections and rendered under this group's own section instead,
 * ahead of the regular sections. Sessions are tested against every
 * registered group in `order`; the FIRST group whose `claim` returns `true`
 * takes a given session (never two groups, never a group and the regular
 * sections both). A group nothing claims renders no section at all.
 */
export interface SessionGroupContribution {
  claim(session: SessionListItemTarget): boolean;
  title?(session: SessionListItemTarget): string | undefined;
  /**
   * Optional: call the listener when `claim` results may have changed. The
   * list re-renders. See `SessionMenuContribution.subscribe`.
   */
  subscribe?(listener: () => void): () => void;
}
/**
 * The `inject` business face of one `amiba.sessions.item.menu` registration:
 * `ctx.slots.register({ name: "amiba.sessions.item.menu", id, order, label,
 * inject: () => ({ visible, run, subscribe }) }, NoopComponent)`. Appended to
 * a session row's "more" (⋯) menu after the built-in actions, first visible
 * plugin item carrying the divider. The registered component itself is
 * never mounted — same `options`/`inject()`-only contract as the group slot
 * above.
 */
export interface SessionMenuContribution {
  /** Omitted means always visible. */
  visible?(session: SessionListItemTarget): boolean;
  /** Invoked on click. A throw/rejection is caught by the list and logged —
   *  it never bubbles into the row. */
  run(session: SessionListItemTarget): void | Promise<void>;
  /**
   * Optional: call the listener when `visible`'s result may have changed.
   * The list re-renders. See `SessionGroupContribution.subscribe`.
   */
  subscribe?(listener: () => void): () => void;
}

/** Optional business face for sources whose ids depend on connected accounts. */
export interface MessageSourceContribution {
  resolve(pluginId: string): string | undefined;
  subscribe?(listener: () => void): () => void;
}

/**
 * `amiba.message.source` maps an exact source id to a label. Plugins may also
 * supply a MessageSourceContribution to resolve dynamic ids and notify the
 * shell when account names change. Unknown sources get a readable UI fallback.
 *
 * Static slot typing for the three registrations above. The runtime
 * declaration lives in `apply()` below, on `root`'s `children` table
 * (`"amiba.sessions.list.group"` / `"amiba.sessions.item.menu"` /
 * `"amiba.message.source"`, `{ kind: "list", scope: "root" }`) — that
 * alone is enough for the slot to exist and to be read via
 * `ctx.slots.entriesOfSlot(...)`, but it does NOT put the name in `SlotMap`,
 * so a plugin's own `ctx.slots.register({ name: "amiba.sessions.list.group",
 * ... })` would not typecheck without this augmentation (`register`'s `name`
 * parameter is typed `keyof SlotMap & string`). Declared here, beside the
 * `inject` face types it names, rather than in `@amiba/extension-sdk`'s
 * `AMIBA_ROOT_SLOTS` vocabulary: these slots are read directly off
 * `entriesOfSlot` (see `session-list-sources.ts`) and never dispatched
 * through `renderSlot`, so they have no place in `AmibaShellSlot`
 * (extension-sdk sits below this package in the dependency graph and cannot
 * import `SessionGroupContribution`/`SessionMenuContribution` from here to
 * declare it either way).
 *
 * Deliberately NO `inject` field on either `SlotMap` entry: per
 * `SlotSpec`/`ChildrenDecl` (`@deepseek-ai/dsh-client-ui-slots`'s
 * `lib/types/index.d.ts`), a `SlotMap[K].inject` is the SHARED face the
 * *declaring parent* (root, here) must supply once in its own `children`
 * spec and every entry receives identically — the mechanism
 * `amiba.workspace.navigation`'s `inject: { openWorkspace }` uses. That is
 * not what these slots want: `SessionGroupContribution`/
 * `SessionMenuContribution` are each REGISTRANT's own per-entry business
 * face, supplied the ordinary way via that entry's own `options.inject`
 * factory (`register`'s `I extends object` overload, structurally inferred,
 * independent of whatever `SlotMap[K]` declares) — exactly like
 * `amiba.navigation.before`/`.after` below, which also carry no `inject` in
 * `SlotMap` yet support per-entry business faces freely. Adding `inject`
 * here instead makes root's own `{ kind: "list", scope: "root" }` children
 * entry fail to typecheck (`Property 'inject' is missing`) since it would
 * then have to supply ONE shared contribution for every plugin, which is
 * nonsensical for a per-plugin `claim`/`run`.
 */
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface SlotMap {
    "amiba.connection.access": {
      kind: "list"; scope: "root";
      owner: { configuration: { ownerId: string; recordId: string } };
    };
    "amiba.sessions.list.group": { kind: "list"; scope: "root" };
    "amiba.sessions.item.menu": { kind: "list"; scope: "root" };
    "amiba.message.source": { kind: "list"; scope: "root" };
    "amiba.conversation.notice": { kind: "keyed"; scope: "session"; owner: { source: string; summary: string; body: string; reference?: NoticeReference } };
    "amiba.tool.execution": { kind: "single"; scope: "session"; owner: import("@amiba/extension-sdk").ToolCallOwnerProps & { fallback: import("react").ReactNode } };
    "amiba.tool.activity": { kind: "list"; scope: "session"; owner: { callId: string } };
    "amiba.conversation.progress": { kind: "list"; scope: "session" };
    "amiba.workbench.panel": { kind: "list"; scope: "session"; owner: import("@amiba/extension-sdk").WorkbenchPanelOwner };
  }
}

type AmibaRootProps = PropsRuntime<"root"> &
  PropsRenderSlots<AmibaShellSlot> & {
    dshClient: DshApiClient;
    settingsSections: SettingsSectionsSource;
    settingsOnboardingSteps: SettingsOnboardingStepsSource;
    openSettingsSection: (sectionId: string) => void;
    sessionsBridge: AmibaSessionsBridge;
    openLineageSession: (sessionId: import("@deepseek-ai/dsh-client-runtime/client").SessionId) => void;
    triggerRuntime: AmibaInputTriggerBridge;
    hiddenSessionIds: HiddenSessionsSource;
    sessionListGroups: ContributionsSource<SessionGroupRow>;
    sessionItemMenuItems: ContributionsSource<SessionMenuItemRow>;
    messageSources: ContributionsSource<MessageSourceRow>;
    markdownSource: ContributionsSource<MarkdownExtension>;
    surfaces: SurfaceSelections;
    mainPanels: MainPanelNavigation;
    mainPanelList: ContributionsSource<MainPanelRow>;
    workbenchSource: ContributionsSource<WorkbenchViewExtension>;
    directoryFlows: { home: DirectoryFlow; workspace: DirectoryFlow };
    conversationViews: ContributionsSource<ConversationViewEntry>;
    cordisPackages: import("./cordis-business.js").CordisPackages;
    legacyToolDetailsAvailable: import("@amiba/extension-sdk").ObservableSnapshot<boolean>;
    toolImagesAvailable: import("@amiba/extension-sdk").ObservableSnapshot<boolean>;
    lineageAvailable: import("@amiba/extension-sdk").ObservableSnapshot<boolean>;
    commandRowKeys: import("@amiba/extension-sdk").ObservableSnapshot<readonly string[]>;
    conversationSource: (sessionId: string) => import("@deepseek-ai/dsh-client-runtime/client").SessionFace | undefined;
    fileMentions: import("@deepseek-ai/dsh-client-ui-conversation/client").ChatFileMentions["forClosing"];
    reportMarkdown: (sessionId:string, capabilities:MarkdownCapabilities[]) => Promise<void>;
    prepareConversation: (sessionId: string) => Promise<string>;
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
  settingsOnboardingSteps,
  openSettingsSection,
  sessionsBridge,
  triggerRuntime,
  hiddenSessionIds,
  sessionListGroups,
  sessionItemMenuItems,
  messageSources,
  markdownSource,
  workbenchSource,
  directoryFlows,
  conversationViews,
  cordisPackages,
  commandRowKeys,
  legacyToolDetailsAvailable,
  toolImagesAvailable,
  lineageAvailable,
  conversationSource,
  fileMentions,
  surfaces,
  mainPanels,
  mainPanelList,
  reportMarkdown,
  prepareConversation,
  renderSlotChain,
  useSessions,
  openLineageSession,
  useWorkspaces,
}: AmibaRootProps): ReactNode {
  const workbench = useSyncExternalStore(workbenchSource.subscribe, workbenchSource.getSnapshot, workbenchSource.getSnapshot);
  const markdown = useSyncExternalStore(markdownSource.subscribe, markdownSource.getSnapshot, markdownSource.getSnapshot);
  useEffect(() => {
    // Boot handshake: the desktop renderer waits for this (or for the
    // [data-amiba-product-shell] node) before flushing queued deep links.
    window.dispatchEvent(new CustomEvent(ROOT_READY_EVENT));
  }, []);

  return (
    <ConversationSubmitProvider prepare={prepareConversation}><WorkbenchExtensionsProvider extensions={workbench}><MarkdownProvider extensions={markdown} report={reportMarkdown}><AmibaProductShell
      mainPanelList={mainPanelList}
      mainPanels={mainPanels}
      dshClient={dshClient}
      openSettingsSection={openSettingsSection}
      renderSlot={renderSlot}
      renderSlotChain={renderSlotChain}
      cordisPackages={cordisPackages}
      commandRowKeys={commandRowKeys}
      legacyToolDetailsAvailable={legacyToolDetailsAvailable}
      toolImagesAvailable={toolImagesAvailable}
      lineageAvailable={lineageAvailable}
      conversationSource={conversationSource}
      fileMentions={fileMentions}
      sessionsBridge={sessionsBridge}
      openLineageSession={openLineageSession}
      settingsSections={settingsSections}
      settingsOnboardingSteps={settingsOnboardingSteps}
      triggerRuntime={triggerRuntime}
      hiddenSessionIds={hiddenSessionIds}
      sessionListGroups={sessionListGroups}
      sessionItemMenuItems={sessionItemMenuItems}
      surfaces={surfaces}
      directoryFlows={directoryFlows}
      conversationViews={conversationViews}
      messageSources={messageSources}
      useOfficialSessions={useSessions}
      useOfficialWorkspaces={useWorkspaces}
    /></MarkdownProvider></WorkbenchExtensionsProvider></ConversationSubmitProvider>
  );
}

export interface AmibaLayoutService {
  /** Supersede pending asynchronous navigation; aborted on the next navigation or root disposal. */
  beginNavigation(): AbortSignal;
  selectPanel(panelId: string | null): void;
  toggleSidebar(): void;
  openDetails(): void;
  closeDetails(): void;
  openChat(): void;
  /**
   * Land on the empty-state home with no active session; an optional
   * `draft` pre-fills the composer WITHOUT sending, so a real session is
   * created only when the user actually submits.
   */
  openNewChat(draft?: string): void;
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
    sidebarRightTabs: SidebarRightTabRegistry;
    composerImages: ReturnType<typeof createDraftImageRegistry>;
    composerInputs: AmibaInputTriggerBridge;
    amibaSessionVisibility: AmibaSessionVisibility;
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
  const sidebarRightTabs = new SidebarRightTabRegistry(ctx);
  // Typert owns descriptors by package, so all shell namespaces mount together.
  const disposeShellRemote = await ctx.remote.$mount({
    package: MARKDOWN_REMOTE.package,
    descriptors: [...MARKDOWN_REMOTE.descriptors, ...CONVERSATION_ENTRY_REMOTE.descriptors],
  });
  ctx.effect(() => disposeShellRemote);
  const reportMarkdown = await createMarkdownReporter(ctx);
  const prepareConversation = await createConversationPreparer(ctx);
  const baseUrl =
    window.location.protocol === "file:"
      ? "http://dsh.internal"
      : window.location.origin;
  const dshClient = new DshApiClient({ baseUrl });
  if (!hasPlatform()) setPlatform(createWebPlatformAdapter(dshClient));
  // A provisional language for the window, published BEFORE any DSH Client
  // plugin registers so their initial labels never inherit index.html's
  // fallback language and then become stuck in a slot snapshot cache. It is
  // the browser-derived value — the same derivation the official locale
  // plugin makes for its own provisional locale — and it is replaced the
  // moment `connectOfficialLocale` installs the official service below.
  seedDocumentLanguage();
  // Amiba's product copy, before anything can render it. The OFFICIAL
  // registration happens further down, guarded by `ctx.inject(["locale"], …)`
  // and superseding this one; this unconditional install is what keeps the
  // shell rendering real strings in a composition where `locale` never
  // resolves — the same runtime-less path Quick-Ask takes.
  const disposeMessageCatalog = installAmibaMessageCatalog();
  document.title = "Amiba";
  const navigation = new LayoutNavigation();
  let mainPanels: MainPanelNavigation | undefined;
  ctx.effect(() => () => navigation.dispose());
  // Use the same event boundary as native navigation, including actions from
  // the desktop host rather than calls through this particular service object.
  ctx.effect(() => {
    const invalidate = (event: Event) => {
      const action = (event as CustomEvent<{ action?: unknown }>).detail?.action;
      if (action === "open-chat" || action === "open-new-chat" || action === "open-workspace") mainPanels?.leavePanel();
      if (action === "open-chat" || action === "open-new-chat" || action === "open-workspace" || action === "open-settings") navigation.commit();
    };
    window.addEventListener("amiba:dsh-layout-action", invalidate);
    return () => window.removeEventListener("amiba:dsh-layout-action", invalidate);
  });
  const layout: AmibaLayoutService = {
    beginNavigation: () => navigation.beginNavigation(),
    selectPanel: (id) => {
      if (!mainPanels) throw new Error("layout.selectPanel: main panels are not ready");
      mainPanels.selectPanel(id);
    },
    toggleSidebar: () => dispatchLayoutAction("toggle-sidebar"),
    openDetails: () => dispatchLayoutAction("open-details"),
    closeDetails: () => dispatchLayoutAction("close-details"),
    openChat: () => dispatchLayoutAction("open-chat"),
    openNewChat: (draft) =>
      dispatchLayoutAction("open-new-chat", draft ? { draft } : {}),
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
    // The onboarding ledger, projected exactly as upstream's shell projects
    // it (`ctx.slots.getVersion` cache key, `id` + `order`, ascending sort,
    // `ctx.slots.subscribe` as the change channel). ONE deviation, and it is
    // the same one Amiba's `settings.section` projection already makes:
    // `entriesOfSlot` instead of the raw `entries`, so a shadowed cell
    // contributes its winner once instead of every registration at that id.
    // The coordinator addresses steps by id and dispatches with
    // `{ only: stepId }`, which renders the elected entry either way.
    let stepsVersion = -1;
    let steps: readonly OnboardingStepRow[] = [];
    const onboardingSource = {
      getSnapshot: () => {
        const version = ctx.slots.getVersion("settings.onboarding");
        if (version !== stepsVersion) {
          stepsVersion = version;
          steps = ctx.slots
            .entriesOfSlot("settings.onboarding")
            .map((entry) => ({
              id: entry.options.id ?? "",
              order: entry.options.order ?? 0,
            }))
            .filter((entry) => entry.id.length > 0)
            .sort((left, right) => left.order - right.order);
        }
        return steps;
      },
      subscribe: (listener: () => void) =>
        ctx.slots.subscribe("settings.onboarding", listener),
    };
    const disposeLayout = ctx.reflect.provide("layout", layout);
    const disposeRightTabRegistry = ctx.reflect.provide("sidebarRightTabs", sidebarRightTabs);
    const resources = new ResourceRegistry(ctx);
    const disposeResources = ctx.reflect.provide("resources", resources);
    const workspaceFiles = getPlatform().workspaceFiles;
    const disposeFileProvider = workspaceFiles?.stat ? resources.register(createFileResourceProvider(workspaceFiles)) : undefined;
    const disposeResourceHook = ctx.slots.provideRoot({ keyedHooks: { resource: address => resources.source(address) } });
    const visibility = createSessionVisibility();
    const disposeVisibility = ctx.reflect.provide(
      "amibaSessionVisibility",
      visibility,
    );
    // The two generic session-list extension points: a "group" that pulls
    // claimed sessions into their own section, and row "more" menu items.
    // Neither carries any plugin semantics here — a feature plugin (the
    // steward, a connector, …) registers into `amiba.sessions.list.group` /
    // `amiba.sessions.item.menu` the same way any other plugin registers
    // into `settings.section`, and the shell just projects the registrations
    // into the shapes `<FullScreenChatView>` renders. See
    // `session-list-sources.ts`.
    const sessionListGroups = createSessionGroupsSource(ctx.slots);
    const sessionItemMenuItems = createSessionMenuItemsSource(ctx.slots);
    // The message-attribution extension point, same declarative shape and
    // just as free of plugin semantics: core carries whatever plugin id the
    // DSH wire put on a message's `origin`, and this projects the
    // registrations into the id → display-name lookup the user bubble reads.
    const messageSources = createMessageSourcesSource(ctx.slots);
    // R1 selection bridge: keep the official ctx.sessions selection (the
    // session resolution every official session-scoped slot renders under)
    // in lock-step with Amiba's own per-window sessions store. The official
    // side's external switches route through the existing Amiba
    // open-session path.
    const sessionsBridge = createSessionsBridge(ctx.sessions, (sessionId, subagent) => {
      window.dispatchEvent(
        new CustomEvent("amiba:open-session", { detail: { sessionId, ...(subagent ? { subagent } : {}) } }),
      );
    }, () => window.dispatchEvent(new CustomEvent("amiba:clear-session")));
    // The OFFICIAL input-trigger pipeline. Services are resolved lazily on
    // every call (`ctx.get`) so boot order stays free and a disabled row is
    // simply an absent service rather than a crash.
    const composerImages = createDraftImageRegistry();
    ctx.effect(() => {
      const off = ctx.reflect.provide("composerImages", composerImages);
      return () => { off(); composerImages.dispose(); };
    }, "native composer draft images");
    const triggerRuntime = createInputTriggerBridge({
      uploadCommandFile: async (sessionId, data, name, signal) => {
        const service = ctx.get("fileUpload") as {upload(sessionId:string,data:Uint8Array,name:string,signal?:AbortSignal):Promise<{ok:true;value:{receiptId:string}}|{ok:false;error:{message:string}}>} | undefined;
        if (!service) throw new Error("File upload service is unavailable.");
        signal?.throwIfAborted();
        const bytes = Uint8Array.from(atob(data), character => character.charCodeAt(0));
        const result = await service.upload(sessionId, bytes, name, signal);
        if (!result.ok) throw new Error(result.error.message);
        return result.value.receiptId;
      },
      residentDraft: sessionId => sessionComposerDraft(getPlatform().storage, sessionId),
      pendingQueue: sessionId => sessionPendingQueue(getPlatform().storage, sessionId),
      mentionProviders: sessionId => {
        const files = getPlatform().workspaceFiles;
        return files ? [makeWorkspaceFilesProvider(files, sessionId)] : [];
      },
      images: () => composerImages,
      sessionFor: sessionId => ctx.sessions.binding(sessionId as never)?.session,
      scopeOf: (sessionId) =>
        ctx.sessions.scope(sessionId as never) as unknown as
          | ClientContext
          | undefined,
      subscribeSessions: (listener) => ctx.sessions.list.subscribe(listener),
      inputTriggers: () =>
        ctx.get("inputTriggers") as unknown as ReturnType<
          Parameters<typeof createInputTriggerBridge>[0]["inputTriggers"]
        >,
      commandUi: () =>
        ctx.get("commandUi") as unknown as ReturnType<
          Parameters<typeof createInputTriggerBridge>[0]["commandUi"]
        >,
    });
    const disposeComposerInputs = ctx.reflect.provide("composerInputs", triggerRuntime);
    ctx.effect(() => {
      const provider = createInputActionsProvider(triggerRuntime);
      try {
        const off = ctx.sessions.provide(provider);
        return () => { off(); provider.dispose(); };
      } catch (error) {
        provider.dispose();
        throw error;
      }
    }, "native input actions");
    // Amiba's own `/` and `@` sources, published through the official
    // registry rather than a private one — so a plugin's `registerSource`
    // and Amiba's own land in the same menu, ranked by the same `order`.
    //
    // Guarded by `ctx.inject`, not registered eagerly: `apply` may well run
    // before `ui-input-trigger` has provided the service, and an eager call
    // would silently register nothing at all — the built-in skills and
    // session groups would simply never appear in-session.
    const conversationDataFiber = ctx.inject(["conversationEvents", "conversationViews"], (scope) => {
      registerConversationNodes(scope);
    });
    const sourcesFiber = ctx.inject(["inputTriggers"], (scope) => {
      scope.effect(
        () => triggerRuntime.registerSources(officialTriggerSources()),
        "amiba-ui-shell: built-in trigger sources",
      );
    });
    // Both dictionary registration and the language mirror follow the
    // official locale service. Keep the shell usable before it is available;
    // standalone surfaces retain browser-derived language resolution.
    const messagesFiber = ctx.inject(["locale"], (scope) => {
      scope.effect(
        () => registerAmibaMessages(scope.locale),
        "amiba-ui-shell: Amiba locale namespace",
      );
    });
    const localeFiber = ctx.inject(
      ["locale"],
      (scope) => {
        scope.effect(
          () =>
            connectOfficialLocale({
              locale: scope.locale,
            }),
          "amiba-ui-shell: official locale authority",
        );
      },
    );
    const markdownSource = createMarkdownSource(ctx.slots);
    const workbenchSource = createWorkbenchSource(ctx.slots);
    const conversationViews = createConversationViewSource(ctx.slots);
    const adoptDirectory = async (path: string) => {
      const workspaces = ctx.get("workspaces");
      if (!workspaces) throw new Error("Workspace service is unavailable");
      return workspaces.create({ path });
    };
    const directoryFlows = {
      home: createDirectoryFlow(ctx.slots, "conversation.hero.workspace.directoryFlow", adoptDirectory),
      workspace: createDirectoryFlow(ctx.slots, "sidebar.workspaces.directoryFlow", adoptDirectory),
    };
    const surfaces = createSurfaceSelections(ctx.slots, getPlatform().storage);
    mainPanels = new MainPanelNavigation(navigation, {
      hasPanel: id => ctx.slots.entriesOfSlot("main").some(entry => entry.options.key === id),
      subscribe: listener => ctx.slots.subscribe("main", listener),
    }, () => {
      dispatchLayoutAction("open-workspace", { viewId: "chats" });
    });
    const panelNavigation = mainPanels;
    const mainPanelList = createMainPanelListSource(ctx.slots, id => ctx.slots.entriesOfSlot("main").some(entry => entry.options.key === id));
    const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: panelNavigation } });
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
          mainPanels: panelNavigation,
          mainPanelList,
          markdownSource,
          workbenchSource,
          directoryFlows,
          conversationViews,
          fileMentions: (owner: import("@deepseek-ai/dsh-client-ui-conversation/client").TurnTailOwnerProps) => ctx.get("chatFileMentions")?.forClosing(owner),
          cordisPackages: (() => {
            const empty: readonly import("./cordis-business.js").CordisBusinessOwner[] = [];
            const runner = () => ctx.get("dynamicCordisRunner" as never) as unknown as import("./cordis-business.js").CordisPackages | undefined;
            return {
              getSnapshot: () => runner()?.getSnapshot() ?? empty,
              subscribe: (listener: () => void) => {
                const fiber = ctx.inject(["dynamicCordisRunner" as never], scope => {
                  scope.effect(() => runner()?.subscribe(listener) ?? (() => {}), "Cordis loaded packages");
                  listener();
                });
                return () => { fiber.dispose(); };
              },
            };
          })(),
          legacyToolDetailsAvailable: {
            getSnapshot: () => ctx.slots.entriesOfSlot("conversation.details.tool").length > 0,
            subscribe: (listener: () => void) => ctx.slots.subscribe("conversation.details.tool", listener),
          },
          toolImagesAvailable: {
            getSnapshot: () => ctx.slots.entriesOfSlot("tool.call.images").length > 0,
            subscribe: (listener: () => void) => ctx.slots.subscribe("tool.call.images", listener),
          },
          commandRowKeys: (() => {
            let version = -1;
            let keys: readonly string[] = [];
            return {
              getSnapshot: () => {
                const next = ctx.slots.getVersion("conversation.chat.commandview");
                if (version !== next) {
                  version = next;
                  keys = ctx.slots.entriesOfSlot("conversation.chat.commandview").flatMap(entry =>
                    typeof entry.options.key === "string" ? [entry.options.key] : []);
                }
                return keys;
              },
              subscribe: (listener: () => void) => ctx.slots.subscribe("conversation.chat.commandview", listener),
            };
          })(),
          lineageAvailable: {
            getSnapshot: () => ctx.slots.entriesOfSlot("conversation.session.header.lineage").length > 0,
            subscribe: (listener: () => void) => ctx.slots.subscribe("conversation.session.header.lineage", listener),
          },
          openLineageSession: (sessionId: import("@deepseek-ai/dsh-client-runtime/client").SessionId) => ctx.sessions.open(sessionId),
          conversationSource: (sessionId: string) => ctx.get("sessions")?.binding(sessionId as import("@deepseek-ai/dsh-client-runtime/client").SessionId)?.session,
          surfaces,
          reportMarkdown,
          prepareConversation,
          settingsSections: sectionsSource,
          settingsOnboardingSteps: onboardingSource,
          openSettingsSection: (sectionId: string) =>
            layout.openSettings(sectionId),
          sessionsBridge,
          triggerRuntime,
          hiddenSessionIds: visibility.source,
          sessionListGroups,
          sessionItemMenuItems,
          messageSources,
        }),
        children: {
          "conversation.chat.turnTail": { kind: "chain", scope: "session" },
          "conversation.hero.workspace.directoryFlow": { kind: "single", scope: "root" },
          "sidebar.workspaces.directoryFlow": { kind: "single", scope: "root" },
          "sidebar.footer.action": { kind: "list", scope: "root" },
          "amiba.message.decoration": { kind: "list", scope: "root" },
          "amiba.emptyState.visual": { kind: "list", scope: "root" },
          "amiba.navigation.before": { kind: "list", scope: "root" },
          "amiba.navigation.after": { kind: "list", scope: "root" },
          // The two generic session-list extension points (a "group" that
          // pulls claimed sessions into their own section, and row "more"
          // menu items). List/root scope, same shape as
          // `amiba.workspace.navigation` just below: a plugin's registered
          // component is a placeholder (never rendered) and the shell reads
          // only `options.{id,order,label}` and `inject()` — see
          // `session-list-sources.ts` and the `SessionGroupContribution` /
          // `SessionMenuContribution` inject-face types exported above.
          "amiba.sessions.list.group": { kind: "list", scope: "root" },
          "amiba.sessions.item.menu": { kind: "list", scope: "root" },
          // Message attribution. The most declarative of the three: no
          // `inject` face at all, only `options.{id,order,label}` — `id` IS
          // the plugin name core reads off a message's wire `source`, and
          // `label` is what the conversation calls it. See
          // `message-source.ts`.
          "amiba.message.source": { kind: "list", scope: "root" },
          "amiba.workspace.navigation": {
            kind: "list",
            scope: "root",
            inject: {
              openWorkspace: (viewId: string) => layout.openWorkspace(viewId),
            },
          },
          "amiba.session.observer": { kind: "list", scope: "root" },
          "amiba.workspace.view": { kind: "list", scope: "root" },
          "main": { kind: "keyed", scope: "root" },
          "sidebar.panellist": { kind: "list", scope: "root" },
          // Official vocabulary: the right-aligned session-header utilities
          // strip, from @deepseek-ai/dsh-client-ui-conversation (replaces
          // the retired amiba.chat.header.after). SESSION scope from a
          // root-scoped parent is legal: neither ChildrenDecl nor the
          // runtime constrains a child's scope to its declarer's — the
          // scope axis only selects which standard kit the ENTRY's
          // components receive, and the renderer's StrictSessionEntry
          // renders null while no official session is current, so the home
          // view is unaffected.
          "conversation.session.header.lineage": { kind: "single", scope: "session" },
          "conversation.session.header.corner": { kind: "single", scope: "session" },
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
          "amiba.conversation.notice": { kind: "keyed", scope: "session" },
          "amiba.tool.execution": { kind: "single", scope: "session" },
          "amiba.tool.activity": { kind: "list", scope: "session" },
          "amiba.conversation.progress": { kind: "list", scope: "session" },
          "amiba.workbench.panel": { kind: "list", scope: "session" },
          "amiba.workbench.view": { kind: "list", scope: "root" },
          // Official vocabulary: the composer's floating overlay anchor,
          // from @deepseek-ai/dsh-client-ui-input-trigger (list, session
          // scope, NO owner share at all — every occupant reads its own
          // store and renders null while closed, so the seat costs nothing
          // when idle). This is where the official trigger menu
          // (ui-input-trigger's MenuView) and the official command popup
          // shell (ui-commands) both land.
          // DECLARATION-ANCHOR divergence, the same one already recorded for
          // tool.call.toolview: upstream declares this seat from
          // ui-conversation's composer entry (the InputBar that owns the
          // input machine), which Amiba has no equivalent of — its composer
          // is its own Lexical surface. Declaring it on this root instead is
          // legal and identical in key/kind/scope/owner; only the
          // declaration site differs. The render site is the composer card
          // (`[data-composer-card]`), which is the anchor the official
          // occupants position against and probe with `closest()`.
          "conversation.input.overlay": { kind: "list", scope: "session" },
          "conversation.input.dock": { kind: "list", scope: "session" },
          "conversation.composer.dock": { kind: "list", scope: "session" },
          "tool.view.cordis": { kind: "keyed", scope: "session" },
          "conversation.chat.commandview": { kind: "keyed", scope: "session" },
          "conversation.input.attachments": { kind: "single", scope: "session-maybe" },
          "conversation.input.left": { kind: "list", scope: "session" },
          "conversation.input.right": { kind: "list", scope: "session" },
          // Official vocabulary: the KEYED per-tool call row, from
          // @deepseek-ai/dsh-client-ui-tool (keyed, session scope, owner
          // ToolCallOwnerProps). Registration key = the wire tool name, an
          // OPEN domain, so this is the one seat whose occupants are not a
          // fixed list. DECLARATION-ANCHOR divergence, recorded once here and
          // in the SDK: upstream declares it from `conversation.chat.node`'s
          // `tool-call` entry (the Chat Node that owns the whole call tree),
          // which Amiba has no equivalent of — its conversation is its own
          // projection. Declaring it on this root instead is legal and the
          // same pattern the adopted conversation.* seats use; only the
          // declaration site differs, never the key/kind/scope/owner.
          "conversation.view": { kind: "list", scope: "session" },
          "conversation.message.images": { kind: "single", scope: "session" },
          "tool.call.images": { kind: "single", scope: "session" },
          "conversation.approval.detail": { kind: "single", scope: "session" },
          "conversation.chat.assistant-actions": { kind: "list", scope: "session" },
          "conversation.details.tool": { kind: "single", scope: "session" },
          "tool.call.toolview": { kind: "keyed", scope: "session" },
          // Amiba's keyed question seat: one entry per question id (a
          // plugin-owned question kind claims exactly its own id), `fallback`
          // is the built-in ClarifyBanner. Same keyed shape as
          // tool.call.toolview, whose key domain is the wire tool name.
          "amiba.conversation.question": { kind: "keyed", scope: "session" },
          // Official vocabulary: the settings-page ledger seat, inherited
          // from @deepseek-ai/dsh-client-ui-settings (owner: { close }).
          "settings.section": {
            kind: "list",
            scope: "root",
          },
          // The rest of the official `settings.*` family, all six of them,
          // all root-scoped, all inherited from
          // @deepseek-ai/dsh-client-ui-settings. DECLARATION-ANCHOR
          // divergence, the same one recorded for tool.call.toolview and
          // conversation.input.overlay: upstream declares these from
          // ui-settings-general's `sidebar.settings` entry (its SettingsRoot
          // owns the trigger button and the modal panel) and declares
          // settings.general.item from that package's General settings.section
          // entry. Amiba runs neither — its settings shell and its General
          // page are its own — so the seats are declared on this root.
          // Key, kind, scope and owner contract are the official ones.
          //
          // The trigger content of the sidebar's settings row; owner
          // { wide } is the sidebar column state, which the chat view knows.
          "amiba.markdown.extension": { kind: "list", scope: "root" },
          "settings.trigger": { kind: "single", scope: "root" },
          // The panel title text; the dialog is named after this node.
          "settings.header": { kind: "single", scope: "root" },
          // Shell-level actions in the page header, before Close.
          "settings.action": { kind: "list", scope: "root" },
          // The close button's visually-hidden label text.
          "settings.close": { kind: "single", scope: "root" },
          // Onboarding steps: the coordinator mounts exactly ONE at a time,
          // in registration order, and the step owns all of its own chrome.
          "settings.onboarding": { kind: "list", scope: "root" },
          // One preference row inside the General section (Amiba's
          // Appearance page). Empty owner by contract — a row draws its own
          // internals, including its label.
          "settings.general.item": { kind: "list", scope: "root" },
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
    const disposeWorkbench = builtinWorkbenchViews.map(extension => ctx.slots.register({
      name: "amiba.workbench.view", id: extension.id, order: extension.order,
      inject: () => ({ extension }),
    }, () => null));
    // CELL SHADOWS of the two official `conversation.input.overlay` entries.
    // Same ids, `priority: -1` against their implicit `0`, so the ledger
    // elects Amiba's component per cell while the official SERVICES stay
    // live. Registered after the root because the root's children table is
    // what declares the seat.
    const disposeSurfaceSettings = ctx.slots.register({ name: "settings.general.item", id: "surface-providers", order: 30, inject: () => ({ surfaces }) }, SurfaceSettings);
    const disposeSlashMenu = ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: SLASH_MENU_ENTRY_ID,
        priority: SHADOW_PRIORITY,
        order: 0,
        inject: (sessionId) => ({
          controller: triggerRuntime.controllerFor(String(sessionId)),
          labels: TRIGGER_SOURCE_LABELS,
          loadingLabel: undefined,
        }),
      },
      AmibaSlashMenuSeat,
    );
    const disposeCommandPopup = ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: COMMAND_POPUP_ENTRY_ID,
        priority: SHADOW_PRIORITY,
        order: 1,
        inject: (sessionId) => {
          const popup = triggerRuntime.popupFor(String(sessionId));
          return {
            popup,
            retry: popup === undefined ? undefined : () => popup.retry(),
          };
        },
      },
      AmibaCommandPopupSeat,
    );
    // CELL SHADOW of the official locale plugin's LanguageRow. The service,
    // persistence, dictionaries, and framework `t` seat remain official;
    // only the DSH-Menu-based pixels are replaced with @amiba/ui's Select.
    // Register lazily because `locale` may arrive after this shell, and keep
    // the same official id so entriesOfSlot elects exactly one language row.
    const sessionExportFiber = mountSessionExportChrome(ctx);
    const languageRowFiber = ctx.inject(["locale"], (scope) => {
      scope.effect(
        () =>
          scope.slots.register(
            {
              name: "settings.general.item",
              id: LANGUAGE_ROW_ENTRY_ID,
              priority: LANGUAGE_ROW_SHADOW_PRIORITY,
              order: 0,
              locale: "amiba",
              inject: () => ({ locale: scope.locale }),
            },
            AmibaLanguageRow,
          ),
        "amiba-ui-shell: language row visual shadow",
      );
    });
    // The keyed per-tool row for the official ask_user_question interaction:
    // Amiba's first `tool.call.toolview` occupant, composed from @amiba/ui's
    // generic ToolRowFrame — the reference pattern for any plugin that wants
    // a bespoke row for its own tool. Registered after the root because the
    // root's children table is what declares the seat.
    const sidebarRightFiber = ctx.inject(['locale'], scope => {
      scope.effect(() => registerSidebarRight(scope, sidebarRightTabs, resources), 'amiba-ui-shell: optional sidebar panel');
      const files = getPlatform().workspaceFiles;
      if (files) scope.effect(() => registerDocumentPreview(scope, sidebarRightTabs, files), 'amiba-ui-shell: document preview');
    });
    const disposeAskToolview = ctx.slots.inject("tool.call.toolview", () =>
      ctx.slots.register(
        { name: "tool.call.toolview", key: "ask_user_question" },
        AskUserQuestionToolview,
      ),
    );
    // Every official runtime tool's row, one occupant per wire name — the
    // presentation core deliberately does not carry (its fallback row is
    // generic by construction).
    const disposeOfficialToolviews = OFFICIAL_TOOLVIEWS.map(
      ({ key, component }) =>
        ctx.slots.inject("tool.call.toolview", () =>
          ctx.slots.register({ name: "tool.call.toolview", key }, component),
        ),
    );
    return () => {
      for (const dispose of disposeOfficialToolviews) dispose();
      void sidebarRightFiber.dispose();
      disposeAskToolview();
      void languageRowFiber.dispose();
      void sessionExportFiber.dispose();
      disposeCommandPopup();
      disposeSurfaceSettings();
      disposeSlashMenu();
      void localeFiber.dispose();
      void messagesFiber.dispose();
      disposeMessageCatalog();
      void conversationDataFiber.dispose();
      void sourcesFiber.dispose();
      void disposeComposerInputs();
      for (const dispose of disposeWorkbench) dispose();
      directoryFlows.home.dispose();
      directoryFlows.workspace.dispose();
      panelNavigation.dispose();
      disposePanelInfo();
      if (mainPanels === panelNavigation) mainPanels = undefined;
      disposeRoot();
      sessionsBridge.dispose();
      disposeFileProvider?.();
      disposeResourceHook();
      void disposeResources();
      void disposeRightTabRegistry();
      void disposeLayout();
      void disposeVisibility();
    };
  }, "amiba-ui-shell: root and semantic child slots");
}
