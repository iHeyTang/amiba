import { browserMessages } from "./locales.js";
import { Globe2 } from "lucide-react";
import {
  BrowserAdapterContext,
  createBrowserAdapter,
  useBrowserAdapter,
} from "./adapter.js";
import type { EmbeddedBrowserAdapter } from "../shared/browser.js";
import { useCallback, useEffect } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {
  WorkbenchResource,
  WorkbenchViewExtension,
  WorkbenchViewProps,
} from "@amiba/extension-sdk";
import {
  getPlatform,
  useWorkspacePane,
} from "@amiba/dsh-plugin-ui-shell/client";
import {
  BrowserViewportContext,
  EmbeddedBrowserHost,
  EmbeddedBrowserWorkspace,
  createEmbeddedBrowserResource,
  type EmbeddedBrowserResource,
} from "./EmbeddedBrowserPane.js";

export const name = "amiba-browser-electron-ui";
export const inject = ["slots"];

/** Whether a key event target is an editable field, so tab shortcuts never hijack text editing. */
function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable
  );
}

function browserData(
  resource: WorkbenchResource,
): EmbeddedBrowserResource | null {
  const value = resource.data as EmbeddedBrowserResource | undefined;
  return resource.type === "browser" &&
    value?.kind === "browser" &&
    typeof value.browserTabId === "string" &&
    typeof value.url === "string"
    ? value
    : null;
}
export function browserResource(url?: string): WorkbenchResource {
  const data = createEmbeddedBrowserResource();
  if (url) Object.assign(data, { url, address: url, loading: true });
  return {
    type: "browser",
    id: data.browserTabId,
    title:
      browserMessages[
        document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en"
      ]["embeddedBrowser.newTab"],
    data,
  };
}

function useBrowserPane() {
  const pane = useWorkspacePane();
  const { updateResourceIn, openResourceIn, sessionId } = pane;
  const update = useCallback(
    (owner: string, id: string, patch: Partial<EmbeddedBrowserResource>) => {
      updateResourceIn(owner, "browser", id, (resource) => {
        const data = browserData(resource);
        if (!data) return resource;
        return {
          ...resource,
          title: patch.title || resource.title,
          data: { ...data, ...patch },
        };
      });
    },
    [updateResourceIn],
  );
  const create = useCallback(
    () => openResourceIn(sessionId, browserResource()),
    [openResourceIn, sessionId],
  );
  return { pane, update, create };
}

function BrowserHost({
  viewportSource,
}: {
  viewportSource: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): HTMLElement | null;
  };
}) {
  const { pane, update } = useBrowserPane();
  const { openResourceIn, focusResourceIn, sessionId } = pane;
  const adapter = useBrowserAdapter();
  useEffect(() => {
    if (!adapter) return;
    const create = adapter.onCreateRequested((event) =>
      openResourceIn(
        event?.sessionId ?? sessionId,
        browserResource(),
        "automatic",
      ),
    );
    const focus = adapter.onFocusRequested((event) =>
      focusResourceIn(
        event.sessionId ?? sessionId,
        "browser",
        event.tabId,
        "automatic",
      ),
    );
    return () => {
      focus();
      create();
    };
  }, [adapter, openResourceIn, focusResourceIn, sessionId]);
  // Cmd/Ctrl+R reloads the active browser tab. The chord is left alone while
  // focus sits in an editable field (or when another view owns the active tab).
  useEffect(() => {
    if (!adapter) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "r") return;
      if (isEditableTarget(event.target)) return;
      if (!pane.open) return;
      const active = pane.activeTab?.resource;
      const data = active?.kind === "extension" ? browserData(active.resource) : null;
      if (!data) return;
      event.preventDefault();
      void adapter.command(data.browserTabId, { action: "reload" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adapter, pane.open, pane.activeTab]);
  const active = pane.activeTab?.resource;
  const selected =
    active?.kind === "extension" ? browserData(active.resource) : null;
  const tabs = pane.resources.flatMap((entry) => {
    const resource = browserData(entry.resource);
    return resource ? [{ sessionId: entry.sessionId, resource }] : [];
  });
  return (
    <EmbeddedBrowserHost
      tabs={tabs}
      shownSessionId={sessionId}
      shownTabId={
        pane.open && pane.mode === "preview"
          ? (selected?.browserTabId ?? null)
          : null
      }
      onUpdateTab={update}
      viewportSource={viewportSource}
    />
  );
}

function BrowserView({ resource, sessionId }: WorkbenchViewProps) {
  const { pane, update, create } = useBrowserPane();
  const data = browserData(resource);
  if (!data) return null;
  const tabs = pane.resources
    .filter((entry) => entry.sessionId === sessionId)
    .flatMap((entry) => {
      const data = browserData(entry.resource);
      return data ? [data] : [];
    });
  return (
    <EmbeddedBrowserWorkspace
      tabs={tabs}
      activeTabId={data.browserTabId}
      visible={pane.open}
      onUpdateTab={(id, patch) => update(sessionId, id, patch)}
      onNewTab={create}
    />
  );
}

const baseBrowserView: WorkbenchViewExtension = {
  id: "amiba.browser.electron",
  resourceType: "browser",
  order: 100,
  component: BrowserView,
  launcher: {
    label: () => document.documentElement.lang.startsWith("zh") ? "打开浏览器" : "Open browser",
    icon: Globe2,
    createResource: () => browserResource(),
  },
  resolveUrl: (url, resources) =>
    resources.find((resource) => browserData(resource)?.url === url) ??
    browserResource(url),
};

export function createBrowserView(
  adapter: EmbeddedBrowserAdapter,
): WorkbenchViewExtension {
  let viewport: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const source = {
    getSnapshot: () => viewport,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(element: HTMLElement | null) {
      viewport = element;
      for (const listener of listeners) listener();
    },
  };
  return {
    ...baseBrowserView,
    host: function BrowserPluginHost() {
      return (
        <BrowserAdapterContext.Provider value={adapter}>
          <BrowserHost viewportSource={source} />
        </BrowserAdapterContext.Provider>
      );
    },
    component: function BrowserPluginView(props) {
      return (
        <BrowserAdapterContext.Provider value={adapter}>
          <BrowserViewportContext.Provider value={source}>
            <BrowserView {...props} />
          </BrowserViewportContext.Provider>
        </BrowserAdapterContext.Provider>
      );
    },
    tabIcon: ({ resource, className }) => {
      const favicon = browserData(resource)?.favicon;
      return favicon ? (
        <img src={favicon} alt="" className={className} />
      ) : (
        <Globe2 className={className} />
      );
    },
  };
}

export async function apply(ctx: ClientContext): Promise<void> {
  const bridge = getPlatform().nativeExtensions;
  if (!bridge) return;
  let disposed = false;
  let cleanup: (() => void) | undefined;
  ctx.effect(
    () => () => {
      disposed = true;
      cleanup?.();
    },
    "amiba-browser-electron-ui",
  );
  const lease = await bridge.connect(
    "@amiba/dsh-plugin-browser-provider-electron",
  );
  if (disposed) return;
  const browserView = createBrowserView(createBrowserAdapter(bridge, lease));
  cleanup = ctx.slots.inject("amiba.workbench.view", () =>
    ctx.slots.register(
      {
        name: "amiba.workbench.view",
        id: browserView.id,
        order: browserView.order,
        inject: () => ({ extension: browserView }),
      },
      () => null,
    ),
  );
}
