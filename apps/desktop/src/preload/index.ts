import type { WorkspaceDocumentReadRequest, WorkspaceDocumentReadResult } from '@amiba/app-runtime/platform';
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { randomUUID } from "node:crypto";
import { getWindowChrome } from "../shared/window-chrome";
import { installWindowOverlaySync } from "./window-overlay";

window.addEventListener("DOMContentLoaded", installWindowOverlaySync, { once: true });

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

/**
 * The startup screen stays up until the main process has warmed every surface
 * the user can reach. The signal can arrive before a listener attaches (main
 * only sends it after the shell reported ready), so the preload latches it.
 */
let shellRevealed = false;
const shellRevealListeners = new Set<() => void>();
ipcRenderer.on("shell:reveal", () => {
  shellRevealed = true;
  for (const listener of [...shellRevealListeners]) listener();
  shellRevealListeners.clear();
});

const api = {
  appUpdates: {
    getState: (): Promise<import("@amiba/app-runtime/platform").AppUpdateState> => ipcRenderer.invoke("app-updates:state"),
    check: (): Promise<import("@amiba/app-runtime/platform").AppUpdateState> => ipcRenderer.invoke("app-updates:check"),
    cancel: (): Promise<import("@amiba/app-runtime/platform").AppUpdateState> => ipcRenderer.invoke("app-updates:cancel"),
    download: (): Promise<import("@amiba/app-runtime/platform").AppUpdateState> => ipcRenderer.invoke("app-updates:download"),
    install: (): Promise<void> => ipcRenderer.invoke("app-updates:install"),
    onChanged: (listener: (state: import("@amiba/app-runtime/platform").AppUpdateState) => void) => {
      const handler = (_event: unknown, state: import("@amiba/app-runtime/platform").AppUpdateState) => listener(state);
      ipcRenderer.on("app-updates:changed", handler);
      return () => { ipcRenderer.removeListener("app-updates:changed", handler); };
    },
  },
  embeddedPage: {
    request: (input: import("../shared/embedded-page").EmbeddedPageRequest) =>
      ipcRenderer.invoke("embedded-page:request", input) as Promise<void>,
  },
  windowChrome: getWindowChrome(process.platform),

  pluginStartup: {
    present: () => ipcRenderer.invoke("plugin-startup:present"),
    choose: (choice: "continue" | "safe") => ipcRenderer.invoke("plugin-startup:choose", choice),
    ready: () => ipcRenderer.invoke("plugin-startup:ready"),
    onState: (callback: (state: import("../shared/plugin-startup").PluginStartupState) => void) => {
      const listener = (_event: unknown, state: import("../shared/plugin-startup").PluginStartupState) => callback(state);
      ipcRenderer.on("plugin-startup:state", listener);
      return () => ipcRenderer.removeListener("plugin-startup:state", listener);
    },
  },
  dshClient: {
    uploadOpen: (url: string): Promise<string> => ipcRenderer.invoke('dsh-client:upload-open', url),
    uploadWrite: (id: string, bytes: Uint8Array): Promise<void> => ipcRenderer.invoke('dsh-client:upload-write', id, bytes),
    uploadFinish: (id: string): Promise<{status:number;body:string}> => ipcRenderer.invoke('dsh-client:upload-finish', id),
    uploadCancel: (id: string): Promise<void> => ipcRenderer.invoke('dsh-client:upload-cancel', id),
    download: (url: string) => ipcRenderer.invoke("dsh-client:download", url),
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
    /**
     * Tells the main process the shell is on screen. Main uses it to start the
     * second/third renderer (see `main/shell-ready.ts`) while the startup screen
     * is still up.
     */
    notifyReady: () => ipcRenderer.send("shell:ready"),
    /**
     * Fires once main has finished warming those surfaces. The callback runs
     * immediately if the signal already arrived.
     */
    onReveal: (listener: () => void) => {
      if (shellRevealed) {
        listener();
        return () => {};
      }
      shellRevealListeners.add(listener);
      return () => shellRevealListeners.delete(listener);
    },
  },

  window: {
    close: () => ipcRenderer.invoke("window:close"),
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
   * filesystem context; binding changes are pushed back via `onChanged`.
   * File previews subscribe to individual resources through `files`.
   * `getPathForFile` exposes Electron 33's
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
    bindIfUnbound: (sessionId: string, p: string): Promise<string | null> =>
      ipcRenderer.invoke("workspace:bind-if-unbound", { sessionId, path: p }),
    resolveRuntimeCwd: (sessionId: string, cwd: string): Promise<string> =>
      ipcRenderer.invoke("workspace:resolve-runtime-cwd", { sessionId, cwd }),
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
    observe: (sessionId: string, path: string, changed: () => void) => {
      const id = randomUUID();
      let disposed = false;
      const handler = (_event: unknown, observed: string) => {
        if (!disposed && observed === id) changed();
      };
      ipcRenderer.on("files:resource-changed", handler);
      const ready: Promise<void> = ipcRenderer.invoke("files:observe-resource", { id, sessionId, path });
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        ipcRenderer.removeListener("files:resource-changed", handler);
        void ipcRenderer.invoke("files:unobserve-resource", id).catch(() => {});
      };
      // Observe registration failures even if a caller disposes before awaiting ready.
      void ready.catch(dispose);
      return { ready, dispose };
    },
    stat: (sessionId: string, path: string) =>
      ipcRenderer.invoke("files:stat", { sessionId, path }),
    readDocument: (sessionId: string, path: string, request: WorkspaceDocumentReadRequest) => {
      const id = randomUUID();
      const result: Promise<WorkspaceDocumentReadResult> = ipcRenderer.invoke("files:read-document", { id, sessionId, path, request });
      let disposed = false;
      return { result, dispose: () => {
        if (disposed) return;
        disposed = true;
        void ipcRenderer.invoke("files:cancel-document", id).catch(() => {});
      } };
    },
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
      // Cancellation must reach main even while native discovery is pending.
      const dispose = () => {
        ipcRenderer.off("files:changed", handler);
        void ipcRenderer.invoke("files:unwatch", subscriptionId).catch(() => {});
      };
      void registration.catch(dispose);
      return dispose;
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
  /**
   * Single shared state contract for every Amiba window. The MAIN process
   * owns the DSH subscriptions (pet library / notification feed / session
   * activity) and broadcasts one snapshot; windows only subscribe and route
   * mutations back. Replaces the old "main window's pets plugin forwards
   * DesktopPetData over desktop-pet:*" pipeline.
   */
  dshState: {
    get: () => ipcRenderer.invoke("dsh-state:get"),
    subscribe: (
      listener: (snapshot: import("../shared/dsh-state").DshStateSnapshot) => void,
    ) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        snapshot: import("../shared/dsh-state").DshStateSnapshot,
      ) => listener(snapshot);
      ipcRenderer.on("dsh-state:snapshot", handler);
      // Deliver the current snapshot on subscribe so a fresh window does not
      // wait for the next source tick (this replaces the old
      // `desktop-pet:data-request` mount handshake).
      void ipcRenderer
        .invoke("dsh-state:get")
        .then((snapshot) => {
          if (snapshot) listener(snapshot as import("../shared/dsh-state").DshStateSnapshot);
        })
        .catch(() => {});
      return () => { ipcRenderer.off("dsh-state:snapshot", handler); };
    },
    activatePet: (id: string | null) =>
      ipcRenderer.invoke("dsh-state:activate-pet", id),
    dismissNotification: (id: string) =>
      ipcRenderer.invoke("dsh-state:dismiss", id),
    markSessionsRead: (
      reads: import("../shared/dsh-state").DshStateReadMarker[],
    ) => ipcRenderer.invoke("dsh-state:mark-read", reads),
    resyncNotifications: () => ipcRenderer.invoke("dsh-state:resync"),
  },
  /**
   * Hosted chat engine surface. The MAIN process runs the app's one
   * DshChatEngineClient (its single set of DSH runtime connections); every
   * window talks to it through this namespace instead of building its own
   * client + engine. Commands mirror the protocol `ChatEngineClient` verbs,
   * `onMessage` receives the engine's routed pushes for THIS window's
   * subscribed sessions, and the serialize hooks let the hosted engine ask
   * this window to resolve its local attachment drafts.
   */
  chatEngine: {
    subscribe: (
      sessionId: string,
      subagent?: import("@amiba/app-runtime/platform").AgentSubagentAddress,
    ) => ipcRenderer.invoke("chat-engine:subscribe", sessionId, subagent),
    unsubscribe: (sessionId: string) =>
      ipcRenderer.invoke("chat-engine:unsubscribe", sessionId),
    requestSnapshot: (sessionId: string) =>
      ipcRenderer.invoke("chat-engine:snapshot", sessionId),
    submit: (
      payload: import("@amiba/app-runtime/protocol").SubmitPayload,
    ) => ipcRenderer.invoke("chat-engine:submit", payload),
    submitWithReceipt: (
      payload: import("@amiba/app-runtime/protocol").SubmitPayload,
    ): Promise<import("@amiba/app-runtime/protocol").SubmitReceipt> =>
      ipcRenderer.invoke("chat-engine:submit-receipt", payload),
    abort: (sessionId: string) =>
      ipcRenderer.invoke("chat-engine:abort", sessionId),
    clear: (sessionId: string) =>
      ipcRenderer.invoke("chat-engine:clear", sessionId),
    clearApproval: (sessionId: string, approvalId: string) =>
      ipcRenderer.invoke("chat-engine:clear-approval", sessionId, approvalId),
    respondToApproval: (
      request: import("@amiba/app-runtime/protocol").ApprovalRequest,
      decision: import("@amiba/app-runtime/protocol").ApprovalDecision,
    ): Promise<import("@amiba/app-runtime/protocol").RuntimeActionResult> =>
      ipcRenderer.invoke("chat-engine:respond-approval", request, decision),
    respondToQuestions: (
      request: import("@amiba/app-runtime/protocol").UserQuestionRequest,
      answers: import("@amiba/app-runtime/protocol").UserQuestionAnswerItem[],
    ): Promise<import("@amiba/app-runtime/protocol").RuntimeActionResult> =>
      ipcRenderer.invoke("chat-engine:respond-questions", request, answers),
    cancelQuestions: (
      request: import("@amiba/app-runtime/protocol").UserQuestionRequest,
    ): Promise<import("@amiba/app-runtime/protocol").RuntimeActionResult> =>
      ipcRenderer.invoke("chat-engine:cancel-questions", request),
    onMessage: (
      listener: (msg: import("@amiba/app-runtime/protocol").EngineToClientMessage) => void,
    ) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        payload:
          | import("@amiba/app-runtime/protocol").EngineToClientMessage
          | import("@amiba/app-runtime/protocol").EngineToClientMessage[],
      ) => {
        // Main coalesces the engine's frames per tick; a batch keeps its order.
        if (Array.isArray(payload)) {
          for (const msg of payload) listener(msg);
          return;
        }
        listener(payload);
      };
      ipcRenderer.on("chat-engine:message", handler);
      return () => ipcRenderer.off("chat-engine:message", handler);
    },
    onSerializeRequest: (
      listener: (request: import("@amiba/app-runtime/dsh-client").ChatEngineBridgeRequest) => void,
    ) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        request: import("@amiba/app-runtime/dsh-client").ChatEngineBridgeRequest,
      ) => listener(request);
      ipcRenderer.on("chat-engine:serialize-request", handler);
      return () => ipcRenderer.off("chat-engine:serialize-request", handler);
    },
    respondSerialize: (
      requestId: string,
      ok: boolean,
      parts: import("@amiba/app-runtime/dsh-client").DshPromptContentPart[],
      error?: string,
    ) =>
      ipcRenderer.send("chat-engine:serialize-response", {
        requestId,
        ok,
        parts,
        ...(error === undefined ? {} : { error }),
      }),
  },
  /**
   * Conversation data plane proxy. Adapter calls (`agentSessions`,
   * `agentWorkspaces`, `agentModels`, presets/settings/credentials/
   * permissions/skills/commands) are executed by the MAIN process on the
   * app's single DshApiClient; windows dispatch JSON args and receive JSON
   * results — no window-local DSH connection for conversation data.
   */
  dshApis: {
    call: (adapter: string, method: string, args: unknown[] = []) =>
      ipcRenderer.invoke("dsh-api:call", { adapter, method, args }),
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
