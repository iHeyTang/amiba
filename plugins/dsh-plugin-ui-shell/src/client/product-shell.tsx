import { SessionsProvider, useSessions, type AgentExecutionContext } from "@amiba/app-runtime/core";
import {
  DshChatEngineClient,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import {
  getPlatform,
  type AgentModelSelection,
} from "@amiba/app-runtime/platform";
import type { PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  AmibaRootSlot,
  ConversationInputPlanOwnerProps,
} from "@amiba/extension-sdk";

import type { AmibaSessionsBridge } from "./sessions-bridge.js";
import { useT } from "@amiba/i18n";
import {
  FullScreenChatView,
  HomeView,
  SettingsView,
  makeWorkspaceFilesProvider,
  type ChatSurfaceCapabilities,
  type ComposerModelPickerRequest,
  type PendingPromptAttachment,
  type PendingPromptResult,
  type ToolCallSeatRequest,
} from "@amiba/ui";
import { NavigationRow } from "@amiba/ui/plugin";
import { Blocks } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from "react";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt";

type View = "chat" | "settings";

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

const EMPTY_SECTIONS: readonly SettingsSectionRow[] = [];

/**
 * Root child slots the product shell dispatches itself: the amiba.* vendor
 * vocabulary plus the official names the root declares
 * (`settings.section`, `shell.overlay`, the two session-header seats —
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
  | "shell.overlay"
  | "conversation.session.header.utilities"
  | "conversation.session.header.actions"
  | "conversation.input.model"
  | "conversation.input.plan"
  | "conversation.input.overlay"
  | "tool.call.toolview";

/** The official DSH child-slot dispatcher, handed down from AmibaRoot. */
export type AmibaShellRenderSlot = PropsRenderSlots<AmibaShellSlot>["renderSlot"];

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
    name:
      typeof value.name === "string" && value.name ? value.name : "file",
    mime:
      typeof value.mime === "string"
        ? value.mime
        : "application/octet-stream",
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

export function AmibaProductShell({
  dshClient,
  openSettingsSection,
  renderSlot,
  sessionsBridge,
  settingsSections,
}: {
  dshClient: DshApiClient;
  openSettingsSection: (sectionId: string) => void;
  renderSlot: AmibaShellRenderSlot;
  sessionsBridge?: AmibaSessionsBridge;
  settingsSections?: SettingsSectionsSource;
}): ReactElement {
  return (
    <SessionsProvider>
      <ProductShellInner
        dshClient={dshClient}
        openSettingsSection={openSettingsSection}
        renderSlot={renderSlot}
        sessionsBridge={sessionsBridge}
        settingsSections={settingsSections}
      />
    </SessionsProvider>
  );
}

function ProductShellInner({
  dshClient,
  openSettingsSection,
  renderSlot,
  sessionsBridge,
  settingsSections,
}: {
  dshClient: DshApiClient;
  openSettingsSection: (sectionId: string) => void;
  renderSlot: AmibaShellRenderSlot;
  sessionsBridge?: AmibaSessionsBridge;
  settingsSections?: SettingsSectionsSource;
}): ReactElement {
  const { t } = useT();
  const platform = getPlatform();
  const desktop = platform.kind === "desktop";
  const topBarHeightPx = platform.windowChrome?.topBarHeightPx ?? 40;
  const topBarLeftInset = platform.windowChrome?.leftInsetPx ?? 0;
  const sections = useSyncExternalStore(
    settingsSections?.subscribe ?? (() => () => {}),
    settingsSections?.getSnapshot ?? (() => EMPTY_SECTIONS),
  );
  const client = useMemo(() => createChatClient(dshClient), [dshClient]);
  const capabilities = useMemo(productCapabilities, []);
  const sessions = useSessions();
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
  const [view, setView] = useState<View>("chat");
  const pendingOpenSessionRef = useRef<string | null>(null);

  useEffect(() => () => client.dispose(), [client]);

  useEffect(() => {
    const onLayoutAction = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const action = detail?.action;
      if (action === "open-chat") {
        setView("chat");
        return;
      }
      if (action === "open-workspace" && typeof detail.viewId === "string") {
        void platform.storage.set({ [SIDEBAR_VIEW_KEY]: detail.viewId });
        setView("chat");
        return;
      }
      if (action === "toggle-sidebar") {
        void (async () => {
          const key = "settings.chat.sidebarCollapsed";
          const current = await platform.storage.get(key);
          await platform.storage.set({ [key]: current[key] !== true });
        })();
        return;
      }
      if (action !== "open-settings") return;
      if (typeof detail.sectionId === "string") {
        const base = window.location.pathname + window.location.search;
        window.history.replaceState(null, "", `${base}#dsh:${detail.sectionId}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
      setView("settings");
    };
    window.addEventListener("amiba:dsh-layout-action", onLayoutAction);
    return () =>
      window.removeEventListener("amiba:dsh-layout-action", onLayoutAction);
  }, [platform.storage]);

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
  // row's WIRE TOOL NAME as `entryKey`, and with Amiba's own `ToolSpec`-driven
  // chip as `fallback` — so an unclaimed name renders exactly what it always
  // did and a registered name takes over that one row only. Both options are
  // load-bearing: without `entryKey` nothing keyed can ever match, without
  // `fallback` an unclaimed tool would render nothing at all.
  const renderToolViewSeat = useCallback(
    (request: ToolCallSeatRequest) =>
      renderSlot("tool.call.toolview", request.owner, {
        entryKey: request.owner.toolName,
        fallback: request.fallback,
      }),
    [renderSlot],
  );

  const openSession = useCallback(
    async (sessionId: string) => {
      const target = sessionId.trim();
      if (!target) return;
      if (!sessions.ready) {
        pendingOpenSessionRef.current = target;
        return;
      }
      await sessions.refresh();
      await sessions.openTab(target);
      await platform.storage.set({ [SIDEBAR_VIEW_KEY]: "chats" });
      setView("chat");
    },
    [platform.storage, sessions.openTab, sessions.ready, sessions.refresh],
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

  if (view === "settings") {
    return (
      <div data-amiba-product-shell className="h-screen w-full">
        <SettingsView
          dshSections={sections}
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
            // leave-Settings path as the sidebar's Home row (onGoHome).
            section: (sectionId) =>
              renderSlot(
                "settings.section",
                { close: () => setView("chat") },
                { only: sectionId },
              ),
            contentOverlay: renderSlot("amiba.settings.content.overlay", {}),
          }}
          onGoHome={() => setView("chat")}
          sidebarHeaderLeftInset={topBarLeftInset}
          sidebarHeaderHeightPx={topBarHeightPx}
          sidebarHeaderClassName={desktop ? "app-drag-region" : undefined}
          paneHeaderClassName={desktop ? "app-drag-region" : undefined}
          paneHeaderChromeHeightPx={
            desktop ? topBarHeightPx : undefined
          }
        />
      </div>
    );
  }

  return (
    <div
      data-amiba-product-shell
      className="relative h-screen w-full overflow-hidden bg-background text-foreground"
    >
      <FullScreenChatView
        client={client}
        capabilities={capabilities}
        mentionProviders={mentionProviders}
        openSettings={(tab) => {
          if (tab) window.location.hash = tab;
          setView("settings");
        }}
        openAgentDestination={(url) => platform.shell.openExternal(url)}
        topBarLeftInset={topBarLeftInset}
        topBarHeightPx={topBarHeightPx}
        topBarClassName={desktop ? "app-drag-region" : undefined}
        restoreSidebarViewOnMount={false}
        slots={{
          emptyState: (
            <HomeView
              onOpenChat={() => {}}
              onOpenSettings={() => setView("settings")}
              panelMode
              modelPicker={renderModelPickerSeat}
            />
          ),
          modelPicker: renderModelPickerSeat,
          planSeat: renderPlanSeat,
          // The official composer overlay anchor. The seat declares NO owner
          // share, so `{}` is the faithful dispatch — anything else would be
          // a fabricated owner. Session-scoped: the renderer resolves the
          // session from the official current (kept in step by the R1
          // bridge) and renders nothing while none is current, which is also
          // why the home/draft composer keeps Amiba's own trigger menu.
          inputOverlay: renderSlot("conversation.input.overlay", {}),
          toolView: renderToolViewSeat,
          navigationBefore: renderSlot("amiba.navigation.before", {}),
          workspaceNavigation: (activeView) =>
            renderSlot("amiba.workspace.navigation", { activeView }),
          navigationAfter: renderSlot("amiba.navigation.after", {}),
          workspaceView: (viewId, owner) =>
            renderSlot("amiba.workspace.view", owner, { only: viewId }),
          // Official session-scoped seat: the renderer resolves the session
          // from the official ctx.sessions current (kept in step by the R1
          // bridge) and renders null while none is current, so the strip is
          // empty on the home view and on a not-yet-materialized draft.
          headerAfter: renderSlot("conversation.session.header.utilities", {}),
          // The title-adjacent counterpart, same session resolution and the
          // same empty owner share the contract declares. The header row it
          // lands in collapses while the seat is empty, so a session with no
          // contributed action looks exactly as it did before the seat
          // existed.
          headerActions: renderSlot("conversation.session.header.actions", {}),
          contentOverlay: renderSlot("amiba.chat.content.overlay", {}),
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[100]">
        {renderSlot("shell.overlay", {})}
      </div>
      <span className="sr-only" aria-live="polite">
        {t("app.initializing")}
      </span>
    </div>
  );
}
