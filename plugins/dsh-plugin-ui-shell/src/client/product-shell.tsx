import { TurnTail, TurnText, useTurnTailAnchors } from "./turn-tail.js";
import { DirectoryChooserContext, type DirectoryChooser } from "@amiba/ui";
import type { DirectoryFlow } from "./directory-flow.js";
import type { ConversationViewEntry } from "./conversation-view-source.js";
import { SurfaceProvider } from "./surface-provider.js";
import type { SurfaceSelections } from "./surface-selections.js";
import { renderOfficialToolFallback } from "./official-toolviews.js";
import {
  SessionsProvider,
  useSessions,
  type AgentExecutionContext,
} from "@amiba/app-runtime/core";
import {
  DshChatEngineClient,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import {
  getPlatform,
  type AgentModelSelection,
} from "@amiba/app-runtime/platform";
import type {
  SessionListState,
  WorkspaceListState,
} from "@deepseek-ai/dsh-client-runtime/client";
import type {
  PropsRenderSlots,
  SnapshotSelectorHook,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {
  AmibaRootSlot,
  ConversationInputPlanOwnerProps,
} from "@amiba/extension-sdk";

import type { AmibaSessionsBridge } from "./sessions-bridge.js";
import {
  useSettingsShell,
  type SettingsOnboardingStepsSource,
} from "./settings-shell.js";
import {
  officialArchivedFingerprint,
  officialListFingerprint,
  useOfficialIndexRefresh,
} from "./official-index-sync.js";
import type { HiddenSessionsSource } from "./session-visibility.js";
import type {
  ContributionsSource,
  SessionGroupRow,
  SessionMenuItemRow,
} from "./session-list-sources.js";
import {
  messageSourceLabelResolver,
  type MessageSourceRow,
} from "./message-source.js";
import { useT } from "@amiba/i18n";
import {
  FullScreenChatView,
  HomeView,
  SettingsDialog,
  SettingsTriggerContent,
  SettingsView,
  makeWorkspaceFilesProvider,
  type ChatSurfaceCapabilities,
  type ComposerModelPickerRequest,
  type ComposerTriggerRuntime,
  type OnboardingStepRow,
  type PendingPromptAttachment,
  type PendingPromptResult,
  type SessionListGroup,
  type SessionListMenuItem,
  type QuestionSeatRequest,
  type ToolCallSeatRequest,
} from "@amiba/ui";
import { PresentationRoot, NavigationRow } from "@amiba/ui/plugin";
import { Blocks } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt";
// Draft-only counterpart consumed by HomeView (see HOME_PENDING_DRAFT_KEY
// there): pre-fills the home composer without sending.
const HOME_PENDING_DRAFT_KEY = "home.pendingDraft";
/** Names the settings dialog after its navigation heading (aria-labelledby). */
const SETTINGS_TITLE_ID = "amiba-settings-title";

export interface SettingsSectionRow {
  id: string;
  label: string;
  /** Nav glyph resolved from the section's `navIcon` inject-face convention. */
  icon?: ReactNode;
}

export interface SettingsSectionsSource {
  getSnapshot: () => readonly SettingsSectionRow[];
  subscribe: (listener: () => void) => () => void;
}

export type { OnboardingStepRow, SettingsOnboardingStepsSource };

const EMPTY_SECTIONS: readonly SettingsSectionRow[] = [];
const EMPTY_HIDDEN_SESSIONS: ReadonlySet<string> = new Set();
const EMPTY_SESSION_GROUPS: readonly SessionGroupRow[] = [];
const EMPTY_SESSION_MENU_ITEMS: readonly SessionMenuItemRow[] = [];
const EMPTY_MESSAGE_SOURCES: readonly MessageSourceRow[] = [];

/**
 * Root child slots the product shell dispatches itself: the amiba.* vendor
 * vocabulary plus the official names the root declares
 * (the whole adopted `settings.*` family — `settings.section` plus the six
 * shell-level seats `settings.trigger` / `.header` / `.action` / `.close` /
 * `.onboarding` / `.general.item` — `shell.overlay`, the two session-header seats —
 * `conversation.session.header.utilities`, the right-aligned strip that
 * replaced the retired `amiba.chat.header.after`, and
 * `conversation.session.header.actions`, the title-adjacent action row —
 * and the two composer control seats, `conversation.input.model` and
 * `conversation.input.plan`, and the composer's floating overlay anchor,
 * `conversation.input.overlay`). Two names from the public vocabulary are
 * absent on purpose:
 *   - `amiba.agentPreset.section` is declared (and dispatched) by
 *     dsh-plugin-agent-preset as a child of its own settings section;
 *   - `amiba.composer.modelPicker` is dispatched through the composer's
 *     `modelPicker` render prop rather than by the shell markup directly.
 *
 * `tool.call.toolview` is the one KEYED member: it rides the chat surface's
 * `toolView` render prop, dispatched once per tool row with the row's wire
 * tool name as `entryKey`.
 */
export type AmibaShellSlot =
  | Exclude<AmibaRootSlot, "amiba.agentPreset.section">
  | "settings.section"
  | "conversation.hero.workspace.directoryFlow"
  | "sidebar.workspaces.directoryFlow"
  | "sidebar.footer.action"
  | "settings.trigger"
  | "settings.header"
  | "settings.action"
  | "settings.close"
  | "settings.onboarding"
  | "settings.general.item"
  | "shell.overlay"
  | "conversation.session.header.utilities"
  | "conversation.session.header.actions"
  | "conversation.input.model"
  | "amiba.conversation.notice"
  | "amiba.tool.execution"
  | "amiba.tool.activity"
  | "amiba.conversation.progress"
  | "amiba.workbench.panel"
  | "conversation.input.plan"
  | "conversation.input.overlay"
  | "conversation.view"
  | "conversation.chat.turnTail"
  | "conversation.chat.assistant-actions"
  | "tool.call.toolview";

/** The official DSH child-slot dispatcher, handed down from AmibaRoot. */
export type AmibaShellRenderSlot =
  PropsRenderSlots<AmibaShellSlot>["renderSlot"];

/**
 * Project the DSH `settings.section` ledger into Amiba's Settings
 * navigation. Rendered DIRECTLY by the product shell (the shell owns both
 * the component and the ledger source, so the former
 * `amiba.settings.navigation.assistant` slot indirection bought nothing);
 * SettingsView's `assistantNavigation` render prop stays the host mechanism
 * receiving the node, and the Settings Shell stays the single selection
 * source through `activeSection`.
 */
function SettingsSectionNavigation({
  activeSection,
  openSettings,
  sections,
}: {
  activeSection?: string;
  openSettings(sectionId: string): void;
  sections: readonly SettingsSectionRow[];
}): ReactNode {
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

function coerceKind(value: unknown): PendingPromptAttachment["kind"] {
  if (value === "image" || value === "text" || value === "pdf") return value;
  return "binary";
}

function normalizeAttachment(raw: unknown): PendingPromptAttachment | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const attachmentId =
    typeof value.attachmentId === "string" ? value.attachmentId : "";
  if (!attachmentId) return null;
  return {
    uiId:
      typeof value.uiId === "string" && value.uiId
        ? value.uiId
        : `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: typeof value.name === "string" && value.name ? value.name : "file",
    mime:
      typeof value.mime === "string" ? value.mime : "application/octet-stream",
    size:
      typeof value.size === "number" && Number.isFinite(value.size)
        ? value.size
        : 0,
    kind: coerceKind(value.kind),
    attachmentId,
    ...(typeof value.thumbDataUrl === "string"
      ? { thumbDataUrl: value.thumbDataUrl }
      : {}),
    ...(typeof value.textPreview === "string"
      ? { textPreview: value.textPreview }
      : {}),
  };
}

async function drainPendingPrompt(): Promise<PendingPromptResult | null> {
  try {
    const storage = getPlatform().storage;
    const snapshot = await storage.get(HOME_PENDING_PROMPT_KEY);
    const raw = snapshot[HOME_PENDING_PROMPT_KEY];
    await storage.remove(HOME_PENDING_PROMPT_KEY);
    if (!raw || typeof raw !== "object") return null;
    const value = raw as Record<string, unknown>;
    const text =
      typeof value.text === "string" && value.text.trim()
        ? value.text
        : undefined;
    const sourceApp =
      typeof value.sourceApp === "string" && value.sourceApp.trim()
        ? value.sourceApp
        : undefined;
    const workspacePath =
      typeof value.workspacePath === "string" && value.workspacePath.trim()
        ? value.workspacePath
        : undefined;
    const agentValue =
      value.agent && typeof value.agent === "object"
        ? (value.agent as Record<string, unknown>)
        : null;
    const agent: AgentExecutionContext | undefined =
      agentValue && typeof agentValue.profileId === "string"
        ? { profileId: agentValue.profileId }
        : undefined;
    const selectionValue =
      value.modelSelection && typeof value.modelSelection === "object"
        ? (value.modelSelection as Record<string, unknown>)
        : null;
    const modelSelection: AgentModelSelection | undefined =
      selectionValue &&
      typeof selectionValue.provider === "string" &&
      typeof selectionValue.model === "string"
        ? {
            provider: selectionValue.provider,
            model: selectionValue.model,
            ...(typeof selectionValue.reasoningEffort === "string"
              ? { reasoningEffort: selectionValue.reasoningEffort }
              : {}),
          }
        : undefined;
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.flatMap((item) => {
          const attachment = normalizeAttachment(item);
          return attachment ? [attachment] : [];
        })
      : [];
    if (!text && !attachments.length) return null;
    return {
      text,
      ...(attachments.length ? { attachments } : {}),
      sourceApp,
      workspacePath,
      agent,
      modelSelection,
    };
  } catch {
    return null;
  }
}

function productCapabilities(): ChatSurfaceCapabilities {
  const platform = getPlatform();
  return {
    pendingPrompt: {
      drain: drainPendingPrompt,
      subscribe: (onChanged) =>
        platform.storage.watch([HOME_PENDING_PROMPT_KEY], (changes) => {
          if (changes[HOME_PENDING_PROMPT_KEY]?.newValue != null) onChanged();
        }),
    },
    ...(platform.workspaceFiles
      ? {
          workspaceInspector: {
            files: platform.workspaceFiles,
            ...(platform.workspaces ? { workspaces: platform.workspaces } : {}),
            ...(platform.workspaceDevelopment
              ? { development: platform.workspaceDevelopment }
              : {}),
          },
        }
      : {}),
  };
}

function createChatClient(dshClient: DshApiClient): DshChatEngineClient {
  return new DshChatEngineClient({
    client: dshClient,
    attachments: getPlatform().agentAttachments,
    resolveSession: async (payload) => {
      const platform = getPlatform();
      const cwd = await platform.workspaces?.getCurrent(payload.sessionId);
      if (!cwd) return {};
      const explicitlyBound = Object.hasOwn(
        (await platform.workspaces?.listBindings()) ?? {},
        payload.sessionId,
      );
      if (explicitlyBound && platform.agentWorkspaces) {
        const { workspace } = await platform.agentWorkspaces.create(cwd);
        return { workspaceId: workspace.workspaceId };
      }
      return { cwd };
    },
    selectModel: async (sessionId, selection, signal) => {
      if (signal.aborted) throw signal.reason;
      const models = getPlatform().agentModels;
      if (models) await models.select(sessionId, selection);
      else await dshClient.selectModel({ sessionId, ...selection }, signal);
    },
  });
}

interface ProductShellProps {
  renderSlotChain: PropsRenderSlots<AmibaShellSlot>["renderSlotChain"];
  conversationSource: (sessionId: string) => import("@deepseek-ai/dsh-client-runtime/client").SessionFace | undefined;
    fileMentions: import("@deepseek-ai/dsh-client-ui-conversation/client").ChatFileMentions["forClosing"];
  directoryFlows: { home: DirectoryFlow; workspace: DirectoryFlow };
  conversationViews: ContributionsSource<ConversationViewEntry>;
  surfaces: SurfaceSelections;
  dshClient: DshApiClient;
  openSettingsSection: (sectionId: string) => void;
  renderSlot: AmibaShellRenderSlot;
  sessionsBridge?: AmibaSessionsBridge;
  settingsSections?: SettingsSectionsSource;
  settingsOnboardingSteps?: SettingsOnboardingStepsSource;
  triggerRuntime?: ComposerTriggerRuntime;
  hiddenSessionIds?: HiddenSessionsSource;
  /** `amiba.sessions.list.group` contributions, sorted by `order`. */
  sessionListGroups?: ContributionsSource<SessionGroupRow>;
  /** `amiba.sessions.item.menu` contributions, sorted by `order`. */
  sessionItemMenuItems?: ContributionsSource<SessionMenuItemRow>;
  /** `amiba.message.source` contributions, sorted by `order`. */
  messageSources?: ContributionsSource<MessageSourceRow>;
  /**
   * The framework's `useSessions` standard hook (`GlobalStandardProps`),
   * handed down from the root entry. It is the OFFICIAL sessions list store —
   * the same one upstream's settings shell reads — and the only thing the
   * onboarding coordinator's active fact depends on.
   *
   * REQUIRED, and a hook, so it is called unconditionally: the framework puts
   * it on every slot component's props, so the one construction site
   * (`AmibaRoot`) always has it. Making it optional would mean either a
   * conditional hook call or a fabricated `SessionListState` standing in for
   * the real store — the second is exactly the kind of invention this
   * adoption forbids.
   */
  useOfficialSessions: SnapshotSelectorHook<SessionListState>;
  /**
   * The framework's `useWorkspaces` standard hook, from the same
   * `GlobalStandardProps` kit. The archive set is workspace-registry state,
   * not session-list state — `workspace.list` returns it as the reconnect
   * baseline and `host/archived-sessions-changed` pushes the full set — so it
   * is a SECOND live source Amiba's own index has to follow. REQUIRED for the
   * same reason as `useOfficialSessions`.
   */
  useOfficialWorkspaces: SnapshotSelectorHook<WorkspaceListState>;
}

export function AmibaProductShell(props: ProductShellProps): ReactElement {
  return (
    <SessionsProvider>
      <ProductShellInner {...props} />
    </SessionsProvider>
  );
}

function ProductShellInner({
  renderSlotChain,
  conversationSource,
  fileMentions,
  directoryFlows,
  conversationViews,
  dshClient,
  openSettingsSection,
  renderSlot,
  sessionsBridge,
  settingsSections,
  settingsOnboardingSteps,
  triggerRuntime,
  hiddenSessionIds,
  sessionListGroups,
  sessionItemMenuItems,
  messageSources,
  surfaces,
  useOfficialSessions,
  useOfficialWorkspaces,
}: ProductShellProps): ReactElement {
  const { t } = useT();
  const platform = getPlatform();
  const desktop = platform.kind === "desktop";
  const topBarHeightPx = platform.windowChrome?.topBarHeightPx ?? 40;
  const topBarLeftInset = platform.windowChrome?.leftInsetPx ?? 0;
  const standaloneTitleBar = platform.windowChrome?.standaloneTitleBar === true;
  const sections = useSyncExternalStore(
    settingsSections?.subscribe ?? (() => () => {}),
    settingsSections?.getSnapshot ?? (() => EMPTY_SECTIONS),
  );
  const hiddenSessions = useSyncExternalStore(
    hiddenSessionIds?.subscribe ?? (() => () => {}),
    hiddenSessionIds?.getSnapshot ?? (() => EMPTY_HIDDEN_SESSIONS),
  );
  // The two generic session-list extension points. Neither the shell nor
  // `<FullScreenChatView>`/`<Sidebar>`/`<SessionsListView>` know anything
  // about who registered a group or a menu item — `sessionGroupList` is the
  // plain `{ id, label, claim }` list `SessionsListView` partitions the
  // sidebar history list with, and `sessionMenuItems` is the plain `{ id,
  // label, visible?, run }` list it appends to each row's "more" menu
  // (`order` stripped in both cases — it only matters for sorting the raw
  // contributions, which `sessionListGroups`/`sessionItemMenuItems` already
  // did).
  const sessionGroups = useSyncExternalStore(
    sessionListGroups?.subscribe ?? (() => () => {}),
    sessionListGroups?.getSnapshot ?? (() => EMPTY_SESSION_GROUPS),
  );
  const sessionMenuItems = useSyncExternalStore(
    sessionItemMenuItems?.subscribe ?? (() => () => {}),
    sessionItemMenuItems?.getSnapshot ?? (() => EMPTY_SESSION_MENU_ITEMS),
  );
  // Message attribution, read exactly the same way: the shell never learns
  // WHOSE messages these are, only that some plugin id has a display name.
  const messageSourceRows = useSyncExternalStore(
    messageSources?.subscribe ?? (() => () => {}),
    messageSources?.getSnapshot ?? (() => EMPTY_MESSAGE_SOURCES),
  );
  const sessionGroupList = useMemo<readonly SessionListGroup[]>(
    () => sessionGroups.map(({ id, label, claim, title }) => ({ id, label, claim, title })),
    [sessionGroups],
  );
  const messageSourceLabel = useMemo(
    () => messageSourceLabelResolver(messageSourceRows),
    [messageSourceRows],
  );
  const sessionMenuItemList = useMemo<readonly SessionListMenuItem[]>(
    () =>
      sessionMenuItems.map(({ id, label, visible, run }) => ({
        id,
        label,
        ...(visible ? { visible } : {}),
        run,
      })),
    [sessionMenuItems],
  );
  // Settings is a MODAL LAYER, not a route: the chat surface stays mounted
  // behind it, exactly as the official settings shell layers its panel over
  // the app frame. The section a given open lands on stays hash-owned, so
  // every existing deep link keeps working — it now opens the dialog on that
  // section instead of swapping the whole main area. The same hook runs the
  // official onboarding coordinator.
  const settings = useSettingsShell({
    steps: settingsOnboardingSteps,
    useOfficialSessions,
  });
  const { open: settingsOpen, close: closeSettings } = settings;
  const client = useMemo(() => createChatClient(dshClient), [dshClient]);
  const capabilities = useMemo(productCapabilities, []);
  const homeDirectory = useSyncExternalStore(directoryFlows.home.subscribe, directoryFlows.home.getSnapshot, directoryFlows.home.getSnapshot);
  const workspaceDirectory = useSyncExternalStore(directoryFlows.workspace.subscribe, directoryFlows.workspace.getSnapshot, directoryFlows.workspace.getSnapshot);
  const directoryChoosers = useMemo(() => {
    const bind = (flow: DirectoryFlow, available: boolean): DirectoryChooser | undefined => available
      ? (defaultPath, adopt) => flow.choose(defaultPath, platform.workspaces?.chooseDirectory, adopt)
      : undefined;
    return { home: bind(directoryFlows.home, homeDirectory.available), workspace: bind(directoryFlows.workspace, workspaceDirectory.available) };
  }, [directoryFlows, homeDirectory.available, workspaceDirectory.available, platform]);
  const viewEntries = useSyncExternalStore(conversationViews.subscribe, conversationViews.getSnapshot, conversationViews.getSnapshot);
  const sessions = useSessions();
  const turnTailAnchors = useTurnTailAnchors(sessions.activeId ? conversationSource(sessions.activeId) : undefined);
  // Host-side session changes (a plugin creating a task session, a blank
  // session getting its first turn) reach the official list live; re-read
  // Amiba's own index whenever the facts it renders change, so the sidebar
  // does not wait for the next open-by-id or window switch.
  const officialFingerprint = useOfficialSessions(officialListFingerprint);
  // Second trigger, second store: archiving is host-global and arrives on
  // the workspaces store (`host/archived-sessions-changed` carries the full
  // set), so a session archived here, in another window, or by the official
  // workspace browser must re-read Amiba's index too — that read is what
  // moves the row into the 「已归档」 view.
  const officialArchived = useOfficialWorkspaces(officialArchivedFingerprint);
  useOfficialIndexRefresh(
    [officialFingerprint, officialArchived],
    sessions.ready,
    sessions.refresh,
  );
  const activeIdRef = useRef(sessions.activeId);
  activeIdRef.current = sessions.activeId;
  const mentionProviders = useMemo(
    () =>
      platform.workspaceFiles
        ? [
            makeWorkspaceFilesProvider(
              platform.workspaceFiles,
              () => activeIdRef.current,
            ),
          ]
        : [],
    [platform.workspaceFiles],
  );
  const pendingOpenSessionRef = useRef<string | null>(null);
  const externalNavigationRevision = useRef(0);

  useEffect(() => () => client.dispose(), [client]);

  useEffect(() => {
    const onLayoutAction = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const action = detail?.action;
      // `open-settings` is handled by useSettingsShell (it owns the dialog's
      // open state and the hash addressing); the three actions below are the
      // ones that LEAVE settings, so they close it.
      if (action === "open-chat") {
        closeSettings();
        return;
      }
      // Fresh conversation on the empty-state home — no session is created
      // (that happens only when the user actually sends). An optional
      // `draft` pre-fills the HOME composer via `home.pendingDraft` — NOT
      // `home.pendingPrompt`, whose drain auto-sends and whose consumer
      // (ChatSurface's composer) isn't even the surface shown on the
      // empty-state home; HomeView owns that composer and drains the
      // draft key itself.
      if (action === "open-new-chat") {
        const draft =
          typeof detail.draft === "string" && detail.draft.trim()
            ? detail.draft
            : undefined;
        void (async () => {
          if (draft) {
            await platform.storage.set({ [HOME_PENDING_DRAFT_KEY]: draft });
          }
          await sessions.deselect();
          await platform.storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
        })();
        closeSettings();
        return;
      }
      if (action === "open-workspace" && typeof detail.viewId === "string") {
        void platform.storage.set({ [SIDEBAR_VIEW_KEY]: detail.viewId });
        closeSettings();
        return;
      }
      if (action === "toggle-sidebar") {
        void (async () => {
          const key = "settings.chat.sidebarCollapsed";
          const current = await platform.storage.get(key);
          await platform.storage.set({ [key]: current[key] !== true });
        })();
      }
    };
    window.addEventListener("amiba:dsh-layout-action", onLayoutAction);
    return () =>
      window.removeEventListener("amiba:dsh-layout-action", onLayoutAction);
  }, [closeSettings, platform.storage, sessions.deselect]);

  // The composer's model-picker chip, seat-split (R5): the official
  // session-scoped conversation.input.model while the composer has a
  // session (owner { locked } — the occupant reads engine data over the
  // official wire), the vendor session-less hero seat while drafting.
  const renderModelPickerSeat = useCallback(
    (request: ComposerModelPickerRequest) =>
      request.seat === "session"
        ? renderSlot("conversation.input.model", request.owner)
        : renderSlot("amiba.composer.modelPicker", request.owner),
    [renderSlot],
  );

  // The composer's plan-status control: one official seat, no vendor split
  // (the seat is session-scoped and has no hero counterpart, so a
  // session-less composer simply renders nothing here). Composer computes
  // the whole owner share the contract defines — `{ locked }` — and passes
  // it through; the shell only dispatches.
  const renderPlanSeat = useCallback(
    (owner: ConversationInputPlanOwnerProps) =>
      renderSlot("conversation.input.plan", owner),
    [renderSlot],
  );

  // The official KEYED tool-call row. Dispatched once per tool row with the
  // row's WIRE TOOL NAME as `entryKey`. Intrinsic runtime tools reuse their
  // semantic row as the fallback while a strict session slot is unavailable.
  // Unknown tools retain the generic row; plugin registrations still win.
  const renderToolViewSeat = useCallback(
    (request: ToolCallSeatRequest) => {
      const fallback = renderSlot("tool.call.toolview", request.owner, {
        entryKey: request.owner.toolName,
        fallback: renderOfficialToolFallback(request.owner, request.fallback),
      });
      return renderSlot(
        "amiba.tool.execution",
        { ...request.owner, fallback },
        { fallback },
      );
    },
    [renderSlot],
  );

  // Amiba's KEYED per-question seat. Dispatched once per pending request with
  // the FIRST question's id as `entryKey`, and with Amiba's own ClarifyBanner
  // as `fallback` — so an unclaimed question id renders exactly what it
  // always did and a registered id takes over that one question only. Both
  // options are load-bearing for the same reasons as the tool-view seat.
  const renderQuestionSeat = useCallback(
    (request: QuestionSeatRequest) =>
      renderSlot("amiba.conversation.question", request.owner, {
        entryKey: request.owner.request.questions[0]?.id ?? "",
        fallback: request.fallback,
      }),
    [renderSlot],
  );

  // The official `settings.trigger` seat. Owner share = `{ wide }`, the
  // sidebar column state, which only the chat view knows — hence a renderer
  // rather than a node. Amiba's own gear + label rides as the dispatch
  // `fallback`, so an unoccupied SINGLE seat leaves the row exactly as it
  // was. Amiba deliberately registers no entry of its own here: a priority-0
  // occupant on a single slot makes the next registration THROW, which would
  // lock every third-party plugin out of the seat.
  const renderSettingsTrigger = useCallback(
    (owner: { wide: boolean }) =>
      renderSlot("settings.trigger", owner, {
        fallback: <SettingsTriggerContent wide={owner.wide} />,
      }),
    [renderSlot],
  );

  const { onboardingStepId, completeOnboardingStep } = settings;

  const openSession = useCallback(
    async (sessionId: string) => {
      const target = sessionId.trim();
      if (!target) return;
      if (!sessions.ready) {
        pendingOpenSessionRef.current = target;
        return;
      }
      const revision = ++externalNavigationRevision.current;
      await sessions.refresh();
      if (revision !== externalNavigationRevision.current) return;
      await sessions.openTab(target);
      if (revision !== externalNavigationRevision.current) return;
      await platform.storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
      closeSettings();
    },
    [
      closeSettings,
      platform.storage,
      sessions.openTab,
      sessions.ready,
      sessions.refresh,
    ],
  );

  useEffect(() => {
    const listener = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: unknown }>).detail
        ?.sessionId;
      if (typeof sessionId === "string") void openSession(sessionId);
    };
    window.addEventListener("amiba:open-session", listener);
    return () => window.removeEventListener("amiba:open-session", listener);
  }, [openSession]);

  useEffect(() => {
    if (!sessions.ready || !pendingOpenSessionRef.current) return;
    const target = pendingOpenSessionRef.current;
    pendingOpenSessionRef.current = null;
    void openSession(target);
  }, [openSession, sessions.ready]);

  useEffect(() => {
    const listener = () => {
      externalNavigationRevision.current++;
      pendingOpenSessionRef.current = null;
      void sessions.deselect();
    };
    window.addEventListener("amiba:clear-session", listener);
    return () => window.removeEventListener("amiba:clear-session", listener);
  }, [sessions.deselect]);

  // R1 amiba→official selection projection: every activeId transition
  // (including the mount-time empty selection, which converges a restored
  // official selection onto this window's per-window-empty design) is
  // mirrored into the official ctx.sessions current — the session
  // resolution the official conversation.* seats render under. The bridge
  // handles the open-after-list race and echo suppression.
  // useLayoutEffect, not useEffect: the projection must land BEFORE paint,
  // or the already-committed render resolves the official session-scoped
  // seats under the previous session and that stale frame is painted.
  useLayoutEffect(() => {
    sessionsBridge?.setActive(sessions.activeId);
  }, [sessionsBridge, sessions.activeId]);

  if (
    platform.kind === "desktop" &&
    new URLSearchParams(location.search).get("desktopPet") === "1"
  ) {
    return (
      <div data-amiba-product-shell className="h-screen w-full">
        {renderSlot("amiba.workspace.view", {}, { only: "desktop-pet" })}
      </div>
    );
  }

  return (
    <PresentationRoot>
      <DirectoryChooserContext.Provider value={directoryChoosers}>
      <div hidden aria-hidden="true">{renderSlot("amiba.session.observer", { readStates: sessions.sessions.filter(s => s.readAt !== undefined).map(s => ({sessionId: s.id, readAt: s.readAt!})) })}</div>
      <SurfaceProvider surfaces={surfaces} renderSlot={renderSlot}>
        <div
          data-amiba-product-shell
          className="relative h-screen w-full overflow-hidden bg-background text-foreground"
        >
          {homeDirectory.owner.open && <DirectoryFlowSeat key={`home:${homeDirectory.requestId}`} content={renderSlot("conversation.hero.workspace.directoryFlow", homeDirectory.owner)} />}
          {workspaceDirectory.owner.open && <DirectoryFlowSeat key={`workspace:${workspaceDirectory.requestId}`} content={renderSlot("sidebar.workspaces.directoryFlow", workspaceDirectory.owner)} />}
          {standaloneTitleBar && (
            <div
              data-testid="native-window-titlebar"
              className="app-drag-region flex shrink-0 items-center border-b border-border/40 bg-background pl-4 text-xs text-muted-foreground"
              style={{
                height: topBarHeightPx,
                paddingRight: `max(${platform.windowChrome?.rightInsetPx ?? 138}px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)))`,
              }}
            >
              <span className="select-none">Amiba</span>
            </div>
          )}
          <div
            className="relative"
            style={
              standaloneTitleBar
                ? { height: `calc(100% - ${topBarHeightPx}px)` }
                : undefined
            }
          >
            <FullScreenChatView
              viewportTopInsetPx={standaloneTitleBar ? topBarHeightPx : 0}
              client={client}
              capabilities={capabilities}
              mentionProviders={mentionProviders}
              triggerRuntime={triggerRuntime}
              settingsOpen={settingsOpen}
              openSettings={(tab) => {
                // ErrorBlock's recovery targets are registry hash ids
                // (`models`/`connection`/`logs`), not `settings.section` ids, so
                // they are written raw — SettingsView's own routing resolves an
                // unknown bare id against the section ledger.
                if (tab) window.location.hash = tab;
                settings.openAt();
              }}
              openAgentDestination={(url) => platform.shell.openExternal(url)}
              topBarLeftInset={topBarLeftInset}
              topBarHeightPx={topBarHeightPx}
              topBarClassName={desktop ? "app-drag-region" : undefined}
              restoreSidebarViewOnMount={false}
              hiddenSessionIds={hiddenSessions}
              groups={sessionGroupList}
              itemMenuItems={sessionMenuItemList}
              messageSourceLabel={messageSourceLabel}
              slots={{
                conversationViews: viewEntries,
                conversationView: (id) => renderSlot("conversation.view", {}, { only: id }),
                emptyState: (
                  <HomeView
                    triggerRuntime={triggerRuntime}
                    onOpenChat={() => {}}
                    onOpenSettings={() => settings.openAt()}
                    panelMode
                    modelPicker={renderModelPickerSeat}
                  />
                ),
                settingsTrigger: renderSettingsTrigger,
                sidebarFooterActions: owner => renderSlot("sidebar.footer.action", owner),
                modelPicker: renderModelPickerSeat,
                planSeat: renderPlanSeat,
                notice: (owner, fallback) =>
                  renderSlot("amiba.conversation.notice", owner, {
                    entryKey: owner.reference
                      ? `reference:${owner.reference.kind}`
                      : owner.source,
                    fallback,
                  }),
                toolAnnotation: (owner) =>
                  renderSlot("amiba.tool.activity", owner),
                progress: () => renderSlot("amiba.conversation.progress", {}),
                workbenchPanel: (owner) =>
                  renderSlot("amiba.workbench.panel", owner),
                // The official composer overlay anchor. The seat declares NO owner
                // share, so `{}` is the faithful dispatch — anything else would be
                // a fabricated owner. Session-scoped: the renderer resolves the
                // session from the official current (kept in step by the R1
                // bridge) and renders nothing while none is current, which is also
                // why the home/draft composer keeps Amiba's own trigger menu.
                inputOverlay: renderSlot("conversation.input.overlay", {}),
                messageText: (runtimeTurn, children, openFile, timeline) => <TurnText timeline={timeline} source={conversationSource(sessions.activeId)} runtimeTurn={runtimeTurn} openFile={openFile} fileMentions={fileMentions}>{children}</TurnText>,
                turnTailAnchors,
                turnTail: (runtimeTurn, openFile) => <TurnTail source={conversationSource(sessions.activeId)} runtimeTurn={runtimeTurn} openFile={openFile} render={owner => renderSlotChain("conversation.chat.turnTail", owner)} />,
                assistantActions: (messageId) => renderSlot("conversation.chat.assistant-actions", { messageId: messageId as import("@amiba/extension-sdk").AssistantActionOwnerProps["messageId"] }),
                toolView: renderToolViewSeat,
                questionSeat: renderQuestionSeat,
                navigationBefore: renderSlot("amiba.navigation.before", {}),
                workspaceNavigation: (activeView) =>
                  renderSlot("amiba.workspace.navigation", {
                    activeView,
                    sessionActivity: {
                      sessions: sessions.sessions,
                      visibleSessionId:
                        activeView === "chats" ? sessions.activeId : "",
                      markUnread: sessions.markUnread,
                      markRead: sessions.markRead,
                    },
                  }),
                navigationAfter: renderSlot("amiba.navigation.after", {}),
                workspaceView: (viewId, owner) =>
                  renderSlot(
                    "amiba.workspace.view",
                    {
                      ...owner,
                      sessionActivity: {
                        sessions: sessions.sessions,
                        visibleSessionId: "",
                        markUnread: sessions.markUnread,
                        markRead: sessions.markRead,
                      },
                    },
                    { only: viewId },
                  ),
                // Official session-scoped seat: the renderer resolves the session
                // from the official ctx.sessions current (kept in step by the R1
                // bridge) and renders null while none is current, so the strip is
                // empty on the home view and on a not-yet-materialized draft.
                headerAfter: renderSlot(
                  "conversation.session.header.utilities",
                  {},
                ),
                // The title-adjacent counterpart, same session resolution and the
                // same empty owner share the contract declares. The header row it
                // lands in collapses while the seat is empty, so a session with no
                // contributed action looks exactly as it did before the seat
                // existed.
                headerActions: renderSlot(
                  "conversation.session.header.actions",
                  {},
                ),
                contentOverlay: renderSlot("amiba.chat.content.overlay", {}),
              }}
            />
          </div>
          {/*
        Settings, as a modal dialog layered over the chat surface above.
        The structure is the official shell's (mask + `role="dialog"
        aria-modal="true"` panel named through `aria-labelledby`, Escape and
        mask-click close paths); the pixels, the navigation, the page
        registry and the scaffold are Amiba's, unchanged.
      */}
          <SettingsDialog
            onClose={closeSettings}
            open={settingsOpen}
            titleId={SETTINGS_TITLE_ID}
          >
            <SettingsView
              dshSections={sections}
              headerId={SETTINGS_TITLE_ID}
              onClose={closeSettings}
              // The official `settings.close` seat: the close button's
              // visually-hidden label. Empty owner share by contract. Amiba's own
              // copy rides as the fallback, which is the job upstream's own
              // CloseLabel registration does — Amiba cannot register it, because
              // a priority-0 occupant on a SINGLE slot makes the next
              // registration throw.
              // `fallback` is the ONLY way to supply Amiba's own copy for a
              // SINGLE seat: Amiba cannot register into it (a priority-0
              // occupant makes the first third-party registration throw), and a
              // `??` on the dispatch result never fires — renderSlot returns a
              // real `<div data-slot>` element for an EMPTY seat, not nullish.
              closeLabel={renderSlot(
                "settings.close",
                {},
                { fallback: t("common.close") },
              )}
              slots={{
                assistantNavigation: (activeSection) => (
                  <SettingsSectionNavigation
                    activeSection={activeSection}
                    openSettings={openSettingsSection}
                    sections={sections}
                  />
                ),
                // Official settings.section owner contract: `close` is the one
                // shell affordance a section receives, wired to the same
                // close-the-dialog path as the header button and Escape.
                section: (sectionId) =>
                  renderSlot(
                    "settings.section",
                    { close: closeSettings },
                    { only: sectionId },
                  ),
                // The three remaining shell-level seats. All three take the
                // EMPTY owner share their contract declares, so `{}` is the
                // faithful dispatch and anything else would be fabricated.
                // Same fallback rule as `settings.close` above. This one is
                // load-bearing beyond the pixels: the dialog names itself
                // through this node (`aria-labelledby`), so an empty seat with
                // no fallback leaves the dialog with a BLANK accessible name.
                header: renderSlot(
                  "settings.header",
                  {},
                  { fallback: t("chat.settings") },
                ),
                action: renderSlot("settings.action", {}),
                generalItem: renderSlot("settings.general.item", {}),
                contentOverlay: renderSlot(
                  "amiba.settings.content.overlay",
                  {},
                ),
              }}
              // No OS-chrome reserve inside the dialog. `topBarLeftInset` /
              // `topBarHeightPx` still go to the chat surface above (which does
              // own the window's top strip), but Settings is a centred panel
              // floating BELOW the traffic lights now — SettingsDialog keeps it
              // clear of them — so reserving a second time in here would just
              // indent the navigation heading into empty space.
              // `onGoHome` is gone for the same reason: the dialog's own close
              // button is the escape hatch, which is also what upstream's
              // SettingsRoot gives its panel.
              sidebarHeaderHeightPx={topBarHeightPx}
            />
          </SettingsDialog>
          <div className="pointer-events-none absolute inset-0 z-[var(--z-shell-overlay)]">
            {renderSlot("shell.overlay", {})}
          </div>
          {/*
        The onboarding coordinator's single mounted step. Rendered OUTSIDE
        the dialog, exactly as upstream renders it beside the panel: a step
        owns its own visible chrome (including `#root` inert ownership) and
        paints nothing while it is still deciding, so the shell wraps it in
        nothing at all. `{ only: activeStepId }` is what makes "one at a
        time" structural rather than a convention.
      */}
          {onboardingStepId !== undefined &&
            renderSlot(
              "settings.onboarding",
              {
                stepId: onboardingStepId,
                complete: () => completeOnboardingStep(onboardingStepId),
                // Rule 5: "open the settings panel directly on one registered
                // section". Deliberately the SAME affordance the settings
                // navigation uses (`ctx.layout.openSettings(id)`), so a step's
                // deep link and a nav click cannot diverge.
                openSection: openSettingsSection,
              },
              { only: onboardingStepId },
            )}
          <span className="sr-only" aria-live="polite">
            {t("app.initializing")}
          </span>
        </div>
      </SurfaceProvider>
      </DirectoryChooserContext.Provider>
    </PresentationRoot>
  );
}

function DirectoryFlowSeat({ content }: { content: ReactNode }) { return <>{content}</>; }
