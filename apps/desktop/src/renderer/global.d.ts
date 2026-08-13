/**
 * Global ambient declarations for the renderer process. Re-declares the
 * Electron-bridged `window.amiba` shape WITHOUT importing from the preload
 * source — the preload module's `import { contextBridge } from "electron"`
 * leaks into the renderer's typecheck classpath otherwise.
 */

import type { ClientToEngineMessage, EngineToClientMessage } from "@amiba/core";
import type {
  WorkspaceFileChange,
  WorkspaceFileDocument,
  WorkspaceDevelopmentAdapter,
  WorkspaceTreeEntry,
} from "@amiba/platform";

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageChangeMap = Record<string, StorageChange>;

type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string };

interface AmibaBridgeApi {
  storage: {
    get(keys?: string | string[]): Promise<Record<string, unknown>>;
    set(patch: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    onChanged(cb: (changes: StorageChangeMap) => void): () => void;
  };
  chat: {
    send(msg: ClientToEngineMessage): Promise<void>;
    onMessage(cb: (msg: EngineToClientMessage) => void): () => void;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  toolActivity: {
    read(days: number): Promise<import("@amiba/core").ToolActivityReadResult>;
    onChanged(cb: () => void): () => void;
  };
  workspaces: {
    chooseDirectory(defaultPath?: string): Promise<string | null>;
    getDefaultRoot(): Promise<string>;
    bind(sessionId: string, path: string): Promise<void>;
    unbind(sessionId: string): Promise<void>;
    getCurrent(sessionId: string): Promise<string | null>;
    listBindings(): Promise<Record<string, string>>;
    onChanged(cb: (change: WorkspaceChange) => void): () => void;
    getPathForFile(file: File): string;
  };
  files: {
    list(
      sessionId: string,
      query: string,
    ): Promise<{ path: string; isDir: boolean }[]>;
    tree(sessionId: string, path?: string): Promise<WorkspaceTreeEntry[]>;
    search(sessionId: string, query: string): Promise<WorkspaceTreeEntry[]>;
    read(sessionId: string, path: string): Promise<WorkspaceFileDocument>;
    reveal(sessionId: string, path: string): Promise<void>;
    openExternal(sessionId: string, path: string): Promise<void>;
    watch(
      sessionId: string,
      paths: string[],
      cb: (change: WorkspaceFileChange) => void,
    ): () => void;
  };
  workspaceDevelopment: WorkspaceDevelopmentAdapter;
  notifier: {
    onMessage(cb: (msg: unknown) => void): () => void;
    hide(): Promise<void>;
    openSession(sessionId: string): Promise<void>;
    approve(approvalId: string): Promise<void>;
    deny(approvalId: string): Promise<void>;
    demo(
      kind?: "cron-completed" | "chat-completed" | "approval-pending",
    ): Promise<void>;
  };
  quickAsk: {
    onPrefill(
      cb: (payload: { text: string; sourceApp: string }) => void,
    ): () => void;
    dismiss(): Promise<void>;
    openInMain(sessionId: string): Promise<void>;
    setIgnoreMouseEvents(ignore: boolean): Promise<void>;
    resize(
      contentHeightPx: number,
      anchor?: "top" | "center" | "bottom",
    ): Promise<void>;
  };
  hermesRuntime: {
    ensureBackend(): Promise<{ ok: boolean; error?: string }>;
  };
  extensions: {
    listManifests(): Promise<
      Array<{
        manifest: import("@amiba/extension-api").ExtensionManifest;
        path: string;
      }>
    >;
    listRegistry(): Promise<
      import("@amiba/extension-host/preload").ExtensionRegistryItem[]
    >;
    invoke(
      extensionId: string,
      channel: string,
      args: unknown,
    ): Promise<unknown>;
    i18nResources(
      extensionId: string,
      locale: "en" | "zh-CN",
    ): Promise<Record<string, string>>;
    status(): Promise<
      Array<{ id: string; status: string; error?: string; source?: string }>
    >;
    pickFolder(): Promise<string | null>;
    addLocal(
      path: string,
    ): Promise<{ ok: boolean; id?: string; error?: string }>;
    reload(id: string): Promise<{ ok: boolean; error?: string }>;
    uninstall(id: string): Promise<{ ok: boolean; error?: string }>;
    marketplace: {
      getIndexUrl(): Promise<string>;
      list(): Promise<
        | {
            ok: true;
            entries: import("@amiba/extension-host/preload").MarketplaceEntry[];
          }
        | { ok: false; error: string }
      >;
      install(
        entry: import("@amiba/extension-host/preload").MarketplaceEntry,
      ): Promise<
        { ok: true; id: string; version: string } | { ok: false; error: string }
      >;
    };
    onExtensionsChanged(cb: (extensionId: string | null) => void): () => void;
    /**
     * Base URL of the local extension HTTP server (e.g. `http://127.0.0.1:54321`).
     * Cached module-level after the first call.
     */
    getHttpBaseUrl(): Promise<string>;
  };
  managedApps: import("@amiba/managed-apps/bridge").ManagedAppsBridge;
  /** Returns the absolute file:// path of the webview bridge preload bundle. */
  getWebviewPreloadPath(): Promise<string>;
  /** Returns the current { language, theme } init state for a webview. */
  getWebviewInitState(): Promise<{ language: string; theme: string }>;
  /**
   * Push the renderer's resolved language to main for rebroadcast to all
   * extension webviews. Only the renderer can resolve the "auto"
   * preference against `navigator.language`, so it is the source of truth.
   */
  setResolvedLanguage(language: "en" | "zh-CN"): Promise<void>;
  /**
   * Push the renderer's resolved theme to main, which rebroadcasts it to
   * every extension webview. Only the renderer can resolve the "auto"
   * preference against `prefers-color-scheme`, so it is the source of truth.
   */
  setResolvedTheme(theme: "light" | "dark"): Promise<void>;
  /**
   * Subscribe to `chat.startSession` requests forwarded from an
   * extension webview via the host bridge. Payload carries the
   * prompt text the extension wants the assistant to act on.
   * Returns an unsubscribe.
   */
  onChatStartSession(cb: (payload: { text: string }) => void): () => void;
  /** Open the conversation selected from a desktop notification. */
  onOpenSession(cb: (payload: { sessionId: string }) => void): () => void;
}

declare global {
  interface Window {
    amiba: AmibaBridgeApi;
  }
}

export {};
