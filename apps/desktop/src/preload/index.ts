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

  embeddedBrowser: {
    registerTab: (input: {
      tabId: string;
      webContentsId: number;
      active?: boolean;
    }) => ipcRenderer.invoke("embedded-browser:register-tab", input),
    unregisterTab: (tabId: string) =>
      ipcRenderer.invoke("embedded-browser:unregister-tab", tabId),
    setActiveTab: (tabId: string) =>
      ipcRenderer.invoke("embedded-browser:set-active-tab", tabId),
    command: (
      tabId: string,
      command: import("@amiba/platform").EmbeddedBrowserCommand,
    ) => ipcRenderer.invoke("embedded-browser:command", tabId, command),
    detectDevServers: () =>
      ipcRenderer.invoke("embedded-browser:detect-dev-servers"),
    onCreateRequested: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on("embedded-browser:create-tab", handler);
      return () => ipcRenderer.off("embedded-browser:create-tab", handler);
    },
    onFocusRequested: (cb: (event: { tabId: string }) => void) => {
      const handler = (_event: unknown, payload: { tabId: string }) =>
        cb(payload);
      ipcRenderer.on("embedded-browser:focus", handler);
      return () => ipcRenderer.off("embedded-browser:focus", handler);
    },
    onAgentActivity: (
      cb: (event: { tabId: string; action: string; running: boolean }) => void,
    ) => {
      const handler = (
        _event: unknown,
        payload: { tabId: string; action: string; running: boolean },
      ) => cb(payload);
      ipcRenderer.on("embedded-browser:agent-activity", handler);
      return () => ipcRenderer.off("embedded-browser:agent-activity", handler);
    },
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
    tree: (sessionId: string, path?: string) =>
      ipcRenderer.invoke("files:tree", { sessionId, path }),
    search: (sessionId: string, query: string) =>
      ipcRenderer.invoke("files:search", { sessionId, query }),
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

  workspaceDevelopment: {
    ensureProject: (sessionId: string) =>
      ipcRenderer.invoke("workspace:projects:ensure", sessionId),
    listProjects: () => ipcRenderer.invoke("workspace:projects:list"),
    createProject: (name: string, folders: string[]) =>
      ipcRenderer.invoke("workspace:projects:create", { name, folders }),
    addProjectFolder: (projectId: string, folder: string) =>
      ipcRenderer.invoke("workspace:projects:add-folder", {
        projectId,
        folder,
      }),
    bindProjectLocation: (sessionId: string, projectId: string, path: string) =>
      ipcRenderer.invoke("workspace:projects:bind-location", {
        sessionId,
        projectId,
        path,
      }),
    listWorktrees: (sessionId: string) =>
      ipcRenderer.invoke("workspace:worktrees:list", sessionId),
    createWorktree: (sessionId: string, branch: string, baseRef?: string) =>
      ipcRenderer.invoke("workspace:worktrees:create", {
        sessionId,
        branch,
        baseRef,
      }),
    gitStatus: (sessionId: string) =>
      ipcRenderer.invoke("workspace:git:status", sessionId),
    gitDiff: (
      sessionId: string,
      options?: { staged?: boolean; paths?: string[] },
    ) => ipcRenderer.invoke("workspace:git:diff", { sessionId, ...options }),
    gitStage: (sessionId: string, paths?: string[]) =>
      ipcRenderer.invoke("workspace:git:stage", { sessionId, paths }),
    gitUnstage: (sessionId: string, paths?: string[]) =>
      ipcRenderer.invoke("workspace:git:unstage", { sessionId, paths }),
    gitCommit: (sessionId: string, message: string) =>
      ipcRenderer.invoke("workspace:git:commit", { sessionId, message }),
    gitShip: (sessionId: string, remote?: string) =>
      ipcRenderer.invoke("workspace:git:ship", { sessionId, remote }),
    listCheckpoints: (sessionId: string) =>
      ipcRenderer.invoke("workspace:checkpoints:list", sessionId),
    createCheckpoint: (
      sessionId: string,
      label: string,
      options?: import("@amiba/platform").WorkspaceCheckpointOptions,
    ) =>
      ipcRenderer.invoke("workspace:checkpoints:create", {
        sessionId,
        label,
        options,
      }),
    markCheckpointChanged: (sessionId: string, checkpointId: string) =>
      ipcRenderer.invoke("workspace:checkpoints:mark-changed", {
        sessionId,
        checkpointId,
      }),
    restoreCheckpoint: (sessionId: string, checkpointId: string) =>
      ipcRenderer.invoke("workspace:checkpoints:restore", {
        sessionId,
        checkpointId,
      }),
    deleteCheckpoint: (sessionId: string, checkpointId: string) =>
      ipcRenderer.invoke("workspace:checkpoints:delete", {
        sessionId,
        checkpointId,
      }),
    terminalStart: (sessionId: string, terminalId: string) =>
      ipcRenderer.invoke("workspace:terminal:start", { sessionId, terminalId }),
    terminalList: (sessionId: string) =>
      ipcRenderer.invoke("workspace:terminal:list", sessionId),
    terminalGet: (sessionId: string, terminalId: string) =>
      ipcRenderer.invoke("workspace:terminal:get", { sessionId, terminalId }),
    terminalWrite: (sessionId: string, terminalId: string, text: string) => {
      ipcRenderer.send("workspace:terminal:write", {
        sessionId,
        terminalId,
        text,
      });
    },
    terminalResize: (
      sessionId: string,
      terminalId: string,
      columns: number,
      rows: number,
    ) => {
      ipcRenderer.send("workspace:terminal:resize", {
        sessionId,
        terminalId,
        columns,
        rows,
      });
    },
    terminalStop: (sessionId: string, terminalId: string) =>
      ipcRenderer.invoke("workspace:terminal:stop", { sessionId, terminalId }),
    onTerminalData: (cb: (event: unknown) => void) => {
      const handler = (_e: unknown, event: unknown) => cb(event);
      ipcRenderer.on("workspace-terminal:data", handler);
      return () => ipcRenderer.off("workspace-terminal:data", handler);
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

  managedExtensions: {
    list: (options?: { includeArchived?: boolean }) =>
      ipcRenderer.invoke("managed-extensions:list", options),
    get: (extensionId: string) => ipcRenderer.invoke("managed-extensions:get", extensionId),
    create: (request: import("@amiba/managed-extensions").ManagedExtensionCreateRequest) =>
      ipcRenderer.invoke("managed-extensions:create", request),
    requestChange: (extensionId: string, request: string) =>
      ipcRenderer.invoke("managed-extensions:request-change", extensionId, request),
    abortDraft: (extensionId: string, draftId: string, reason?: string) =>
      ipcRenderer.invoke("managed-extensions:abort-draft", extensionId, draftId, reason),
    attachSession: (extensionId: string, draftId: string, sessionId: string) =>
      ipcRenderer.invoke(
        "managed-extensions:attach-session",
        extensionId,
        draftId,
        sessionId,
      ),
    updateMetadata: (
      extensionId: string,
      patch: import("@amiba/managed-extensions").ManagedExtensionMetadataPatch,
    ) => ipcRenderer.invoke("managed-extensions:update-metadata", extensionId, patch),
    archive: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:archive", extensionId),
    restore: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:restore", extensionId),
    exportProject: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:export", extensionId),
    listOutputs: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:list-outputs", extensionId),
    updateOutput: (
      extensionId: string,
      outputId: string,
      patch: { pinned?: boolean; tags?: string[] },
    ) =>
      ipcRenderer.invoke("managed-extensions:update-output", extensionId, outputId, patch),
    listPresets: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:list-presets", extensionId),
    savePreset: (
      extensionId: string,
      input: {
        revisionId: string;
        providerAlias: string;
        toolName: string;
        name: string;
        arguments: Record<string, unknown>;
      },
    ) => ipcRenderer.invoke("managed-extensions:save-preset", extensionId, input),
    deletePreset: (extensionId: string, presetId: string) =>
      ipcRenderer.invoke("managed-extensions:delete-preset", extensionId, presetId),
    confirm: (extensionId: string, revisionId: string) =>
      ipcRenderer.invoke("managed-extensions:confirm", extensionId, revisionId),
    reject: (extensionId: string, revisionId: string) =>
      ipcRenderer.invoke("managed-extensions:reject", extensionId, revisionId),
    rollback: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:rollback", extensionId),
    markUsed: (extensionId: string) =>
      ipcRenderer.invoke("managed-extensions:mark-used", extensionId),
    surface: (
      extensionId: string,
      target?: "active" | "candidate",
      surfaceName?: "main" | "settings",
    ) => ipcRenderer.invoke("managed-extensions:surface", extensionId, target, surfaceName),
    callTool: (input: {
      extensionId: string;
      providerAlias: string;
      name: string;
      arguments?: Record<string, unknown>;
      revisionId?: string;
    }) => ipcRenderer.invoke("managed-extensions:call-tool", input),
    readResource: (input: {
      extensionId: string;
      providerAlias: string;
      uri: string;
      revisionId?: string;
    }) => ipcRenderer.invoke("managed-extensions:read-resource", input),
    onChanged: (cb: (extensionId: string | null) => void) => {
      const handler = (_event: unknown, extensionId: string | null) => cb(extensionId);
      ipcRenderer.on("managed-extensions:changed", handler);
      return () => ipcRenderer.off("managed-extensions:changed", handler);
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
