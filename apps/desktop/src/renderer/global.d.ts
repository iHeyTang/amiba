/**
 * Global ambient declarations for the renderer process. Re-declares the
 * Electron-bridged `window.amiba` shape WITHOUT importing from the preload
 * source — the preload module's `import { contextBridge } from "electron"`
 * leaks into the renderer's typecheck classpath otherwise.
 */

import type {
  WorkspaceFileChange,
  WorkspaceFileDocument,
  WorkspaceDevelopmentAdapter,
  WorkspaceTreeEntry,
} from "@amiba/app-runtime/platform";

type StorageChange = { oldValue?: unknown; newValue?: unknown };
type StorageChangeMap = Record<string, StorageChange>;

type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string };

interface AmibaBridgeApi {
  embeddedPage: {
    request(input: import("../shared/embedded-page").EmbeddedPageRequest): Promise<void>;
  };
  windowChrome: {
    topBarHeightPx: number;
    leftInsetPx: number;
  };
  dshClient: {
    boot(): Promise<{
      baseUrl: string;
      graph: {
        rev: string;
        entries: Array<{
          id: string;
          url: string;
          rev: string;
          inject?: string[];
          external?: string[];
          immediately?: boolean;
        }>;
      };
      shell: {
        /** Inline head scripts to run before the module entry (see main). */
        bootstrap: string[];
        /** Classic plugin-bundle preloads to load before the module entry. */
        preload: string[];
        scripts: string[];
        styles: string[];
      };
    }>;
    fetch(request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: Uint8Array;
    }): Promise<{
      status: number;
      statusText: string;
      headers: Record<string, string>;
      body: Uint8Array;
    }>;
  };
  dshPlugins: import("@amiba/extension-sdk").AmibaDshPluginManagerBridge;
  storage: {
    get(keys?: string | string[]): Promise<Record<string, unknown>>;
    set(patch: Record<string, unknown>): Promise<void>;
    remove(keys: string | string[]): Promise<void>;
    onChanged(cb: (changes: StorageChangeMap) => void): () => void;
  };
  agentDiagnostics: import("@amiba/app-runtime/platform").AgentDiagnosticsAdapter;
  shell: {
    openExternal(url: string): Promise<void>;
  };
  embeddedBrowser: import("@amiba/app-runtime/platform").EmbeddedBrowserAdapter;
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
      kind?: "chat-completed" | "approval-pending" | "plugin",
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
  /** Open the conversation selected from a desktop notification. */
  onOpenSession(cb: (payload: { sessionId: string }) => void): () => void;
  /** Open the settings dialog; fired by the application menu (⌘, / Ctrl+,). */
  onOpenSettings(cb: () => void): () => void;
}

declare global {
  interface Window {
    amiba: AmibaBridgeApi;
  }
}

export {};
