import { createContext, useContext } from "react";
import type { DesktopExtensionBridge } from "@amiba/extension-sdk";
import type {
  EmbeddedBrowserAdapter,
  EmbeddedBrowserPageState,
} from "../shared/browser.js";
export const BrowserAdapterContext = createContext<
  EmbeddedBrowserAdapter | undefined
>(undefined);
export const useBrowserAdapter = () => useContext(BrowserAdapterContext);
export function createBrowserAdapter(
  bridge: DesktopExtensionBridge,
  lease: string,
): EmbeddedBrowserAdapter {
  const call = <T,>(method: string, args?: unknown) =>
    bridge.call(lease, method, args) as Promise<T>;
  const subscribe = <T,>(event: string, listener: (payload: T) => void) =>
    bridge.subscribe(lease, event, (payload) => listener(payload as T));
  return {
    cookieImport: {
      sources: () => call("cookie-import:sources"),
      sites: (sourceId) => call("cookie-import:sites", { sourceId }),
      run: (sourceId, domains, overwrite) =>
        call(domains === null ? "cookie-import:run-all" : "cookie-import:run", {
          sourceId,
          domains,
          overwrite,
        }),
    },
    registerTab: (input) =>
      call<EmbeddedBrowserPageState>("register-tab", input),
    unregisterTab: (tabId) => call<void>("unregister-tab", { tabId }),
    setActiveTab: (tabId) =>
      call<EmbeddedBrowserPageState>("set-active-tab", { tabId }),
    command: (tabId, command) =>
      call<EmbeddedBrowserPageState>("command", { tabId, command }),
    startFrameStream: (tabId, width) =>
      call<void>("start-frame-stream", { tabId, width }),
    stopFrameStream: (tabId) =>
      call<void>("stop-frame-stream", { tabId }),
    onFrame: (tabId, listener) =>
      subscribe("embedded-browser:frame", (payload) => {
        const frame = payload as { tabId: string; data: string };
        if (frame.tabId === tabId) listener(frame);
      }),
    detectDevServers: () => call("detect-dev-servers"),
    openExternal: (url) => call<void>("open-external", { url }),
    onCreateRequested: (listener) =>
      subscribe("embedded-browser:create-tab", listener),
    onFocusRequested: (listener) =>
      subscribe("embedded-browser:focus", listener),
    onAgentActivity: (listener) =>
      subscribe("embedded-browser:agent-activity", listener),
  };
}
