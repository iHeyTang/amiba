import { contextBridge, ipcRenderer, webUtils } from "electron";
import { randomUUID } from "node:crypto";
import { getWindowChrome } from "../shared/window-chrome";

// Node EventEmitter defaults `maxListeners` to 10. Each Amiba window
// stacks more than that on a few high-fan-out IPC channels (storage,
// workspace, chat, quick-ask) because every React hook that
// observes state — wallpaper, schedules, chat, notifications, and the
// platform adapter's `storage.watch` — adds its
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

// Same buffering story for the application menu's Settings… entry: the
// click may have just created the primary window, so the request can land
// before the renderer's listener exists. A boolean is enough — repeated
// requests collapse into one open.
const openSettingsListeners = new Set<() => void>();
let pendingOpenSettings = false;

ipcRenderer.on("ui:open-settings", () => {
  if (openSettingsListeners.size === 0) {
    pendingOpenSettings = true;
    return;
  }
  for (const listener of openSettingsListeners) listener();
});

const api = {
  embeddedPage: {
    request: (input: import("../shared/embedded-page").EmbeddedPageRequest) =>
      ipcRenderer.invoke("embedded-page:request", input) as Promise<void>,
  },
  windowChrome: getWindowChrome(process.platform),

  dshClient: {
    boot: () => ipcRenderer.invoke("dsh-client:boot"),
    fetch: (request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: Uint8Array;
    }) => ipcRenderer.invoke("dsh-client:fetch", request),
  },

  dshPlugins: {
    list: () => ipcRenderer.invoke("dsh-plugins:list"),
    installRegistry: (spec: string) =>
      ipcRenderer.invoke("dsh-plugins:install-registry", spec),
    installArchive: () => ipcRenderer.invoke("dsh-plugins:install-archive"),
    remove: (packageName: string) =>
      ipcRenderer.invoke("dsh-plugins:remove", packageName),
    update: (packageName: string) =>
      ipcRenderer.invoke("dsh-plugins:update", packageName),
  } satisfies import("@amiba/extension-sdk").AmibaDshPluginManagerBridge,

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

  agentDiagnostics: {
    status: () => ipcRenderer.invoke("agent-diagnostics:status"),
    restart: () => ipcRenderer.invoke("agent-diagnostics:restart"),
    logs: (
      input?: Parameters<
        import("@amiba/app-runtime/platform").AgentDiagnosticsAdapter["logs"]
      >[0],
    ) => ipcRenderer.invoke("agent-diagnostics:logs", input),
  } satisfies import("@amiba/app-runtime/platform").AgentDiagnosticsAdapter,

  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke("shell:open-external", url),
  },

  nativeExtensions: {
    connect: (packageName: string) => ipcRenderer.invoke("native-extension:connect", packageName),
    call: (lease: string, method: string, args?: unknown) => ipcRenderer.invoke("native-extension:call", lease, method, args),
    subscribe: (lease: string, event: string, listener: (payload: unknown) => void) => {
      const handler = (_event: unknown, message: { lease: string; event: string; payload: unknown }) => {
        if (message.lease === lease && message.event === event) listener(message.payload);
      };
      ipcRenderer.on("native-extension:event", handler);
      return () => { ipcRenderer.off("native-extension:event", handler); };
    },
  } satisfies import("@amiba/extension-sdk").DesktopExtensionBridge,

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
    readBytes: (sessionId: string, path: string) =>
      ipcRenderer.invoke("files:read-bytes", { sessionId, path }),
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
      options?: import("@amiba/app-runtime/platform").WorkspaceCheckpointOptions,
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
   * Spotlight-style Quick-Ask popup bridge. Main fires `prefill` after
   * summon (with the captured selection + source app name); renderer
   * sends `dismiss` / `resize` back. `submit` / `abort` go through the
   * existing `chat.*` channel — the popup uses the same chat engine as
   * the main window, just with its own session id.
   */
  desktopPet: {
    setLanguage: (language: "en" | "zh-CN") => ipcRenderer.invoke("desktop-pet:language", language),
    openConversation: (sessionId: string) => ipcRenderer.invoke("desktop-pet:open-conversation", sessionId),
    onLayout: (listener: (layout: import("@amiba/app-runtime/platform").DesktopPetLayout) => void) => {
      const handler = (_: Electron.IpcRendererEvent, layout: import("@amiba/app-runtime/platform").DesktopPetLayout) => listener(layout);
      ipcRenderer.on("desktop-pet:layout", handler);
      return () => { ipcRenderer.off("desktop-pet:layout", handler); };
    },
    setVisualBounds: (bounds: import("@amiba/app-runtime/platform").DesktopPetLayout["visual"]) => ipcRenderer.invoke("desktop-pet:visual", bounds),
    resize: (corner: "nw" | "ne" | "sw" | "se" | null) => ipcRenderer.invoke("desktop-pet:resize", corner),
    finishResize: () => ipcRenderer.invoke("desktop-pet:finish-resize"),
    getState: () => ipcRenderer.invoke("desktop-pet:get"),
    setEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("desktop-pet:enable", enabled),
    setIgnoreMouse: (ignore: boolean) =>
      ipcRenderer.invoke("desktop-pet:ignore", ignore),
    drag: (active: boolean) => ipcRenderer.invoke("desktop-pet:drag", active),
    ready: () => ipcRenderer.invoke("desktop-pet:ready"),
    menu: (pets: { id: string; name: string }[], activeId: string | null) =>
      ipcRenderer.invoke("desktop-pet:menu", pets, activeId),
    publishActivity: (
      activity: import("../shared/desktop-pet").DesktopPetActivity,
    ) => ipcRenderer.invoke("desktop-pet:activity", activity),
    onState: (
      listener: (
        state: import("../shared/desktop-pet").DesktopPetState,
      ) => void,
    ) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        state: import("../shared/desktop-pet").DesktopPetState,
      ) => listener(state);
      ipcRenderer.on("desktop-pet:state", handler);
      return () => ipcRenderer.off("desktop-pet:state", handler);
    },
    onActivity: (
      listener: (
        state: import("../shared/desktop-pet").DesktopPetActivity,
      ) => void,
    ) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        state: import("../shared/desktop-pet").DesktopPetActivity,
      ) => listener(state);
      ipcRenderer.on("desktop-pet:activity", handler);
      return () => ipcRenderer.off("desktop-pet:activity", handler);
    },
    onPointer: (listener: (point: { x: number; y: number } | null) => void) => {
      const handler = (_: Electron.IpcRendererEvent, point: { x: number; y: number } | null) => listener(point);
      ipcRenderer.on("desktop-pet:pointer", handler);
      return () => ipcRenderer.off("desktop-pet:pointer", handler);
    },
    onSelect: (listener: (id: string) => void) => {
      const handler = (_: Electron.IpcRendererEvent, id: string) =>
        listener(id);
      ipcRenderer.on("desktop-pet:select", handler);
      return () => ipcRenderer.off("desktop-pet:select", handler);
    },
  },
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

  /** Open the settings dialog; fired by the application menu (⌘, / Ctrl+,). */
  onOpenSettings: (cb: () => void) => {
    openSettingsListeners.add(cb);
    if (pendingOpenSettings) {
      pendingOpenSettings = false;
      queueMicrotask(() => {
        if (openSettingsListeners.has(cb)) cb();
      });
    }
    return () => openSettingsListeners.delete(cb);
  },
};

contextBridge.exposeInMainWorld("amiba", api);

export type AmibaBridge = typeof api;
