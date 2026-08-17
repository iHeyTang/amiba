import { SessionsProvider, useSessions, type AgentExecutionContext } from "@amiba/app-runtime/core";
import {
  DshChatEngineClient,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import {
  getPlatform,
  type AgentModelSelection,
} from "@amiba/app-runtime/platform";
import { useT } from "@amiba/i18n";
import {
  FullScreenChatView,
  HomeView,
  SettingsView,
  makeWorkspaceFilesProvider,
  type ChatSurfaceCapabilities,
  type PendingPromptAttachment,
  type PendingPromptResult,
} from "@amiba/ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

const SIDEBAR_VIEW_KEY = "settings.chat.sidebarView";
const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt";

type View = "chat" | "settings";

export interface SettingsSectionRow {
  id: string;
  label: string;
}

export interface SettingsSectionsSource {
  getSnapshot: () => readonly SettingsSectionRow[];
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_SECTIONS: readonly SettingsSectionRow[] = [];

/**
 * data-* attributes on the slot marker element can only carry strings, so
 * they can't hand the settings-section plugin a live function reference
 * (the scaffold's head-actions-host getter). Stash it as a plain JS
 * property on the marker node instead — `findSlotTargets` in ./index.tsx
 * reads it back off the same element after the DOM-attribute scan.
 */
export const SETTINGS_SECTION_HEADER_ACTIONS_HOST_PROP =
  "__amibaSettingsHeaderActionsHost" as const;

export type SlotMarkerElement = HTMLElement & {
  [SETTINGS_SECTION_HEADER_ACTIONS_HOST_PROP]?: () => HTMLElement | null;
};

function SlotTarget({
  name,
  filterId,
  chromeHeightPx,
  activeView,
  activeSettingsSection,
  topBarLeftInset,
  sidebarCollapsed,
  showSidebarExpandControl,
  headerActionsHost,
}: {
  name: string;
  filterId?: string;
  chromeHeightPx?: number;
  activeView?: string;
  activeSettingsSection?: string;
  topBarLeftInset?: number;
  sidebarCollapsed?: boolean;
  showSidebarExpandControl?: boolean;
  headerActionsHost?: () => HTMLElement | null;
}): ReactElement {
  const markerRef = useCallback(
    (el: SlotMarkerElement | null) => {
      if (el) el[SETTINGS_SECTION_HEADER_ACTIONS_HOST_PROP] = headerActionsHost;
    },
    [headerActionsHost],
  );
  return (
    <span
      ref={markerRef}
      className="contents"
      data-amiba-dsh-chrome-height={chromeHeightPx}
      data-amiba-dsh-active-view={activeView}
      data-amiba-dsh-active-section={activeSettingsSection}
      data-amiba-dsh-top-bar-left-inset={topBarLeftInset}
      data-amiba-dsh-sidebar-collapsed={sidebarCollapsed}
      data-amiba-dsh-show-sidebar-expand={showSidebarExpandControl}
      data-amiba-dsh-slot={name}
      data-amiba-dsh-slot-only={filterId}
    />
  );
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
  settingsSections,
}: {
  dshClient: DshApiClient;
  settingsSections?: SettingsSectionsSource;
}): ReactElement {
  return (
    <SessionsProvider>
      <ProductShellInner
        dshClient={dshClient}
        settingsSections={settingsSections}
      />
    </SessionsProvider>
  );
}

function ProductShellInner({
  dshClient,
  settingsSections,
}: {
  dshClient: DshApiClient;
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

  if (view === "settings") {
    return (
      <div data-amiba-product-shell className="h-screen w-full">
        <SettingsView
          dshSections={sections}
          slots={{
            navigationBefore: (
              <SlotTarget name="amiba.settings.navigation.before" />
            ),
            assistantNavigation: (activeSection) => (
              <SlotTarget
                name="amiba.settings.navigation.assistant"
                activeSettingsSection={activeSection}
              />
            ),
            navigationAfter: (
              <SlotTarget name="amiba.settings.navigation.after" />
            ),
            section: (sectionId, owner) => (
              <SlotTarget
                name="amiba.settings.section"
                filterId={sectionId}
                chromeHeightPx={desktop ? topBarHeightPx : undefined}
                headerActionsHost={owner.actionsHost}
              />
            ),
            contentOverlay: (
              <SlotTarget name="amiba.settings.content.overlay" />
            ),
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
            />
          ),
          navigationBefore: <SlotTarget name="amiba.navigation.before" />,
          workspaceNavigation: (activeView) => (
            <SlotTarget
              name="amiba.workspace.navigation"
              activeView={activeView}
            />
          ),
          navigationAfter: <SlotTarget name="amiba.navigation.after" />,
          workspaceView: (viewId, owner) => (
            <SlotTarget
              name="amiba.workspace.view"
              filterId={viewId}
              chromeHeightPx={owner.chromeHeightPx}
              topBarLeftInset={owner.topBarLeftInset}
              sidebarCollapsed={owner.sidebarCollapsed}
              showSidebarExpandControl={owner.showSidebarExpandControl}
            />
          ),
          headerAfter: <SlotTarget name="amiba.chat.header.after" />,
          contentOverlay: <SlotTarget name="amiba.chat.content.overlay" />,
        }}
      />
      <div className="pointer-events-none absolute inset-0 z-[100]">
        <SlotTarget name="amiba.shell.overlay" />
      </div>
      <span className="sr-only" aria-live="polite">
        {t("app.initializing")}
      </span>
    </div>
  );
}
