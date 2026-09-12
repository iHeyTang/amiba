import type { CookieImportAdapter } from "./cookie-import.js";
export type EmbeddedBrowserCommand =
  | { action: "navigate"; url: string }
  | { action: "back" }
  | { action: "forward" }
  | { action: "reload" }
  | { action: "stop" };

export interface EmbeddedBrowserPageState {
  tab_id: string;
  url: string;
  title: string;
  can_go_back: boolean;
  can_go_forward: boolean;
  loading: boolean;
}

/**
 * Plugin-owned bridge for the visible browser workbench.
 *
 * The renderer owns browser chrome and tabs; Electron main owns privileged
 * WebContents lookup and is also the endpoint used by DSH browser tools. A tab
 * is registered only after its isolated `<webview>` has attached.
 */
export interface EmbeddedBrowserAdapter {
  cookieImport?: CookieImportAdapter;
  openExternal(url: string): Promise<void>;
  registerTab(input: {
    tabId: string;
    webContentsId: number;
    active?: boolean;
    /**
     * The chat session this tab belongs to. Main keys its "active tab" per
     * session on it, so a task running in the background gets its own tab
     * instead of steering the workbench the user is looking at.
     */
    sessionId?: string;
  }): Promise<EmbeddedBrowserPageState>;
  unregisterTab(tabId: string): Promise<void>;
  setActiveTab(tabId: string): Promise<EmbeddedBrowserPageState>;
  command(
    tabId: string,
    command: EmbeddedBrowserCommand,
  ): Promise<EmbeddedBrowserPageState>;
  detectDevServers(): Promise<Array<{ url: string; port: number }>>;
  /**
   * Main needs a tab for a browser call and has none it can use. `sessionId`
   * names the session that must own the new tab; it is absent only for calls
   * with no agent behind them, which keep the global behaviour.
   */
  onCreateRequested(
    listener: (event: { sessionId?: string }) => void,
  ): () => void;
  /**
   * Main is about to drive a tab and wants it on screen. The event names the
   * tab's owning session so a background task can bring its OWN workbench
   * forward without touching the session in view.
   */
  onFocusRequested(
    listener: (event: { tabId: string; sessionId?: string }) => void,
  ): () => void;
  onAgentActivity(
    listener: (event: {
      tabId: string;
      action: string;
      running: boolean;
    }) => void,
  ): () => void;
}
