import { contextBridge, ipcRenderer, webUtils } from "electron";
import { randomUUID } from "node:crypto";
import {
  createExtensionsBridge,
  createWebviewPreloadBridge,
} from "@amiba/extension-host/preload";

// Node EventEmitter defaults `maxListeners` to 10. Each Amiba window
// stacks more than that on a few high-fan-out IPC channels (storage,
// workspace, chat, notifier, quick-ask) because every React hook that
// observes state — `useCronRuns`, `useWallpaper`,
// `useResume`, the platform adapter's `storage.watch`, … — adds its
// own listener on top of the shared `ipcRenderer`. Without bumping
// the cap Electron logs "MaxListenersExceededWarning" on every fresh
// mount of the main window, and the warnings drown out real bugs.
// `0` = unlimited; we'd rather chase real leaks via the cleanup
// effects than treat the 10-listener line as load-bearing.
ipcRenderer.setMaxListeners(0);

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageChangeMap = Record<string, StorageChange>;

type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string };

// Mirrors @amiba/core protocol types — kept loose here so preload
// stays runtime-only without pulling the core package into the browser
// context's preload classpath.
type ChatClientMessage = unknown;
type ChatEngineMessage = unknown;

type OpenSessionPayload = { sessionId: string };
const openSessionListeners = new Set<(payload: OpenSessionPayload) => void>();
let pendingOpenSession: OpenSessionPayload | null = null;

// Main may recreate the primary BrowserWindow in response to a notification.
// Buffer the navigation request until React has attached its listener so the
// first click cannot land between `did-finish-load` and effect mounting.
ipcRenderer.on(
  "ui:open-session",
  (_event: unknown, payload: OpenSessionPayload) => {
    if (!payload?.sessionId) return;
    if (openSessionListeners.size === 0) {
      pendingOpenSession = payload;
      return;
    }
    for (const listener of openSessionListeners) listener(payload);
  },
);

const api = {
  storage: {
    get: (keys?: string | string[]) => ipcRenderer.invoke("storage:get", keys),
    set: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke("storage:set", patch),
    remove: (keys: string | string[]) =>
      ipcRenderer.invoke("storage:remove", keys),
    onChanged: (cb: (changes: StorageChangeMap) => void) => {
      const handler = (_e: unknown, changes: StorageChangeMap) => cb(changes);
      ipcRenderer.on("storage:changed", handler);
      return () => ipcRenderer.off("storage:changed", handler);
    },
  },

  chat: {
    /** Send any ClientToEngineMessage to the main-process chat engine. */
    send: (msg: ChatClientMessage) =>
      ipcRenderer.invoke("chat:client-to-engine", msg),
    /** Subscribe to engine → client frames (events + snapshots). */
    onMessage: (cb: (msg: ChatEngineMessage) => void) => {
      const handler = (_e: unknown, msg: ChatEngineMessage) => cb(msg);
      ipcRenderer.on("chat:engine-to-client", handler);
      return () => ipcRenderer.off("chat:engine-to-client", handler);
    },
  },

  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("shell:open-external", url),
  },

  /**
   * Tool-activity ledger bridge for the Tools page. Capture + storage
   * live in main (`tool-activity.ts`); `read` is a read-only window over
   * the per-day buckets plus the lifetime aggregate, and `onChanged`
   * relays main's debounced ledger-write broadcast so the renderer can
   * refetch on push instead of polling.
   */
  toolActivity: {
    read: (days: number) => ipcRenderer.invoke("tool-activity:read", { days }),
    onChanged: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("tool-activity:changed", handler);
      return () => ipcRenderer.off("tool-activity:changed", handler);
    },
  },

  /**
   * Workspace binding bridge. A bound directory gives the chat session
   * filesystem context; changes inside that tree are pushed back via
   * `onChanged` so the renderer can re-render the indicator and (later)
   * surface a "files changed" cue. `getPathForFile` exposes Electron 33's
   * webUtils so the renderer can resolve a dropped folder's absolute path
   * (the legacy `File.path` field is gone).
   */
  workspaces: {
    chooseDirectory: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke("workspace:choose-directory", defaultPath),
    getDefaultRoot: (): Promise<string> =>
      ipcRenderer.invoke("workspace:get-default-root"),
    bind: (sessionId: string, p: string): Promise<void> =>
      ipcRenderer.invoke("workspace:bind", { sessionId, path: p }),
    unbind: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke("workspace:unbind", sessionId),
    getCurrent: (sessionId: string): Promise<string | null> =>
      ipcRenderer.invoke("workspace:get-current", sessionId),
    listBindings: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke("workspace:list-bindings"),
    onChanged: (cb: (change: WorkspaceChange) => void) => {
      const handler = (_e: unknown, change: WorkspaceChange) => cb(change);
      ipcRenderer.on("workspace:changed", handler);
      return () => ipcRenderer.off("workspace:changed", handler);
    },
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  /**
   * `@file` mention source for the desktop chat. Lists the active session's
   * bound workspace dir (top level only) filtered by the typed query; the
   * renderer's Files TriggerProvider maps the rows into composer menu items.
   */
  files: {
    list: (
      sessionId: string,
      query: string,
    ): Promise<{ path: string; isDir: boolean }[]> =>
      ipcRenderer.invoke("files:list", { sessionId, query }),
    read: (sessionId: string, path: string) =>
      ipcRenderer.invoke("files:read", { sessionId, path }),
    reveal: (sessionId: string, path: string): Promise<void> =>
      ipcRenderer.invoke("files:reveal", { sessionId, path }),
    openExternal: (sessionId: string, path: string): Promise<void> =>
      ipcRenderer.invoke("files:open-external", { sessionId, path }),
    watch: (
      sessionId: string,
      paths: string[],
      cb: (change: {
        subscriptionId: string;
        sessionId: string;
        path: string;
        event: "add" | "change" | "unlink";
      }) => void,
    ) => {
      const subscriptionId = randomUUID();
      const handler = (
        _e: unknown,
        change: {
          subscriptionId: string;
          sessionId: string;
          path: string;
          event: "add" | "change" | "unlink";
        },
      ) => {
        if (change.subscriptionId === subscriptionId) cb(change);
      };
      ipcRenderer.on("files:changed", handler);
      const registration = ipcRenderer.invoke("files:watch", {
        subscriptionId,
        sessionId,
        paths,
      });
      return () => {
        ipcRenderer.off("files:changed", handler);
        void registration.finally(() =>
          ipcRenderer.invoke("files:unwatch", subscriptionId),
        );
      };
    },
  },

  /**
   * Heads-up Notifier bridge. The notifier renderer (bottom-right floating
   * window) listens for `notifier:message` pushes from main and sends
   * approve/deny/activate-main back over their own channels.
   */
  /**
   * Spotlight-style Quick-Ask popup bridge. Main fires `prefill` after
   * summon (with the captured selection + source app name); renderer
   * sends `dismiss` / `resize` back. `submit` / `abort` go through the
   * existing `chat.*` channel — the popup uses the same chat engine as
   * the main window, just with its own session id.
   */
  quickAsk: {
    onPrefill: (cb: (payload: { text: string; sourceApp: string }) => void) => {
      const handler = (
        _e: unknown,
        payload: { text: string; sourceApp: string },
      ) => cb(payload);
      ipcRenderer.on("quick-ask:prefill", handler);
      return () => ipcRenderer.off("quick-ask:prefill", handler);
    },
    dismiss: () => ipcRenderer.invoke("quick-ask:dismiss"),
    openInMain: (sessionId: string) =>
      ipcRenderer.invoke("quick-ask:open-in-main", sessionId),
    setIgnoreMouseEvents: (ignore: boolean) =>
      ipcRenderer.invoke("quick-ask:set-ignore-mouse", ignore),
    resize: (
      contentHeightPx: number,
      anchor: "top" | "center" | "bottom" = "top",
    ) => ipcRenderer.invoke("quick-ask:resize", contentHeightPx, anchor),
  },

  /**
   * Microphone access helpers. ``ensureAccess()`` is a thin wrapper
   * around ``systemPreferences.askForMediaAccess`` in main — call it
   * before ``getUserMedia`` so on macOS the OS dialog fires the first
   * time and the cached decision is returned afterwards.
   */
  voice: {
    ensureMicrophoneAccess: (): Promise<
      "granted" | "denied" | "restricted" | "not-determined" | "unknown"
    > => ipcRenderer.invoke("voice:ensure-microphone-access"),
  },

  notifier: {
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_e: unknown, msg: unknown) => cb(msg);
      ipcRenderer.on("notifier:message", handler);
      return () => ipcRenderer.off("notifier:message", handler);
    },
    hide: () => ipcRenderer.invoke("notifier:hide"),
    openSession: (sessionId: string) =>
      ipcRenderer.invoke("notifier:open-session", sessionId),
    approve: (approvalId: string) =>
      ipcRenderer.invoke("notifier:approve", approvalId),
    deny: (approvalId: string) =>
      ipcRenderer.invoke("notifier:deny", approvalId),
    /**
     * Fire a demo notifier card so the user can confirm the floating
     * window appears and clicks register. Call from the main window's
     * devtools console:
     *   window.amiba.notifier.demo()                  // cron card
     *   window.amiba.notifier.demo("approval-pending") // approval card
     */
    demo: (kind?: "cron-completed" | "chat-completed" | "approval-pending") =>
      ipcRenderer.invoke("notifier:demo", kind),
  },

  extensions: createExtensionsBridge(),

  managedApps: {
    list: (options?: { includeArchived?: boolean }) =>
      ipcRenderer.invoke("managed-apps:list", options),
    get: (appId: string) => ipcRenderer.invoke("managed-apps:get", appId),
    create: (request: import("@amiba/managed-apps").ManagedAppCreateRequest) =>
      ipcRenderer.invoke("managed-apps:create", request),
    requestChange: (appId: string, request: string) =>
      ipcRenderer.invoke("managed-apps:request-change", appId, request),
    attachSession: (appId: string, draftId: string, sessionId: string) =>
      ipcRenderer.invoke("managed-apps:attach-session", appId, draftId, sessionId),
    updateMetadata: (
      appId: string,
      patch: import("@amiba/managed-apps").ManagedAppMetadataPatch,
    ) => ipcRenderer.invoke("managed-apps:update-metadata", appId, patch),
    archive: (appId: string) => ipcRenderer.invoke("managed-apps:archive", appId),
    restore: (appId: string) => ipcRenderer.invoke("managed-apps:restore", appId),
    exportProject: (appId: string) => ipcRenderer.invoke("managed-apps:export", appId),
    listOutputs: (appId: string) => ipcRenderer.invoke("managed-apps:list-outputs", appId),
    updateOutput: (
      appId: string,
      outputId: string,
      patch: { pinned?: boolean; tags?: string[] },
    ) => ipcRenderer.invoke("managed-apps:update-output", appId, outputId, patch),
    listPresets: (appId: string) => ipcRenderer.invoke("managed-apps:list-presets", appId),
    savePreset: (appId: string, input: {
      revisionId: string;
      providerAlias: string;
      toolName: string;
      name: string;
      arguments: Record<string, unknown>;
    }) => ipcRenderer.invoke("managed-apps:save-preset", appId, input),
    deletePreset: (appId: string, presetId: string) =>
      ipcRenderer.invoke("managed-apps:delete-preset", appId, presetId),
    confirm: (appId: string, revisionId: string) =>
      ipcRenderer.invoke("managed-apps:confirm", appId, revisionId),
    reject: (appId: string, revisionId: string) =>
      ipcRenderer.invoke("managed-apps:reject", appId, revisionId),
    rollback: (appId: string) => ipcRenderer.invoke("managed-apps:rollback", appId),
    markUsed: (appId: string) => ipcRenderer.invoke("managed-apps:mark-used", appId),
    surface: (
      appId: string,
      target?: "active" | "candidate",
      surfaceName?: "main" | "settings",
    ) => ipcRenderer.invoke("managed-apps:surface", appId, target, surfaceName),
    callTool: (input: {
      appId: string;
      providerAlias: string;
      name: string;
      arguments?: Record<string, unknown>;
      revisionId?: string;
    }) => ipcRenderer.invoke("managed-apps:call-tool", input),
    readResource: (input: {
      appId: string;
      providerAlias: string;
      uri: string;
      revisionId?: string;
    }) => ipcRenderer.invoke("managed-apps:read-resource", input),
    onChanged: (cb: (appId: string | null) => void) => {
      const handler = (_event: unknown, appId: string | null) => cb(appId);
      ipcRenderer.on("managed-apps:changed", handler);
      return () => ipcRenderer.off("managed-apps:changed", handler);
    },
  },

  ...createWebviewPreloadBridge(),

  /**
   * Push the renderer's resolved language ("en" | "zh-CN") to main for
   * rebroadcast to all extension webviews. Only the renderer can resolve
   * the "auto" preference against `navigator.language`.
   */
  setResolvedLanguage: (language: "en" | "zh-CN"): Promise<void> =>
    ipcRenderer.invoke("language:set-resolved", language),

  /**
   * Same pattern as setResolvedLanguage but for theme ("light" | "dark").
   * Only the renderer can resolve the "auto" preference against
   * `prefers-color-scheme`.
   */
  setResolvedTheme: (theme: "light" | "dark"): Promise<void> =>
    ipcRenderer.invoke("theme:set-resolved", theme),

  /**
   * Subscribe to `chat.startSession` requests forwarded from an
   * extension webview. The renderer does the actual orchestration
   * (mint a fresh session via the Sessions context, then queue the
   * prompt + flip the sidebar) — this bridge just delivers the text.
   */
  onChatStartSession: (cb: (payload: { text: string }) => void) => {
    const handler = (_e: unknown, payload: { text: string }) => cb(payload);
    ipcRenderer.on("ui:chat-start-session", handler);
    return () => ipcRenderer.off("ui:chat-start-session", handler);
  },

  /**
   * Deliver a notification's explicit View action to the primary renderer.
   * The module-level buffer covers a newly-created window whose React effect
   * has not mounted yet when main sends the first navigation request.
   */
  onOpenSession: (cb: (payload: OpenSessionPayload) => void) => {
    openSessionListeners.add(cb);
    const pending = pendingOpenSession;
    if (pending) {
      pendingOpenSession = null;
      queueMicrotask(() => {
        if (openSessionListeners.has(cb)) cb(pending);
      });
    }
    return () => openSessionListeners.delete(cb);
  },

  /** Validate and start Amiba's immutable built-in Hermes services. */
  hermesRuntime: {
    ensureBackend: (): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke("hermes:ensure-backend"),
  },
};

contextBridge.exposeInMainWorld("amiba", api);

export type AmibaBridge = typeof api;
