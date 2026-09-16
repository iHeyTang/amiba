import { browserMessages, useBrowserT } from "./locales.js";
import { Globe2 } from "lucide-react";
import {
  BrowserAdapterContext,
  createBrowserAdapter,
  useBrowserAdapter,
} from "./adapter.js";
import type { EmbeddedBrowserAdapter } from "../shared/browser.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {
  WorkbenchResource,
  WorkbenchSummaryContribution,
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
  const { pane, update, create } = useBrowserPane();
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
  // Browser tab shortcuts: Cmd/Ctrl+T opens a new tab, Cmd/Ctrl+R reloads the
  // active tab, Cmd/Ctrl+Shift+R hard-reloads it, and Cmd/Ctrl+←/→ navigate
  // history. The chords are left alone while focus sits in an editable field
  // (or when another view owns the active tab).
  useEffect(() => {
    if (!adapter) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const cmdOrCtrl = event.metaKey || event.ctrlKey;
      if (!cmdOrCtrl) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (!event.shiftKey && key === "t") {
        if (!pane.enabled) return;
        event.preventDefault();
        create();
        return;
      }
      if (!pane.open) return;
      const active = pane.activeTab?.resource;
      const data = active?.kind === "extension" ? browserData(active.resource) : null;
      if (key === "arrowleft") {
        if (!data) return;
        event.preventDefault();
        void adapter.command(data.browserTabId, { action: "back" });
        return;
      }
      if (key === "arrowright") {
        if (!data) return;
        event.preventDefault();
        void adapter.command(data.browserTabId, { action: "forward" });
        return;
      }
      if (key === "r" && data) {
        event.preventDefault();
        void adapter.command(data.browserTabId, {
          action: event.shiftKey ? "hardReload" : "reload",
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adapter, pane.open, pane.activeTab, pane.enabled, create]);
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

/**
 * A small, non-interactive live `<webview>` used as a page preview inside the
 * summary popover. It reuses the workbench's partition so cookies/storage are
 * shared, but it is NOT registered with main (it is display-only). It is
 * created imperatively because the summary is outside the workbench's webview
 * host and must not double-register the tab.
 */
function PreviewWebview({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !url || url === "about:blank") return;
    const webview = document.createElement("webview");
    webview.setAttribute("src", url);
    webview.setAttribute("partition", "persist:amiba-browser");
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.minWidth = "0";
    webview.style.minHeight = "0";
    webview.style.pointerEvents = "none";
    webview.style.border = "0";
    webview.style.display = "flex";
    container.appendChild(webview);
    return () => {
      webview.remove();
    };
  }, [url]);
  return (
    <div
      ref={containerRef}
      className="h-40 w-full overflow-hidden rounded-t-lg bg-background"
    />
  );
}

/**
 * The browser group of the pinned summary popover. The active tab renders as a
 * live page preview; the rest stack (favicon + title + URL) behind an expand
 * toggle. A click on any entry focuses that tab inside the workbench.
 */
function BrowserSummary({ sessionId }: { sessionId: string }) {
  const pane = useWorkspacePane();
  const { t } = useBrowserT();
  const [expanded, setExpanded] = useState(false);
  const tabs = pane.resources
    .filter((entry) => entry.sessionId === sessionId)
    .flatMap((entry) => {
      const data = browserData(entry.resource);
      return data ? [data] : [];
    });
  if (tabs.length === 0) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        {t("embeddedBrowser.summary.empty")}
      </p>
    );
  }
  const open = (tabId: string) =>
    pane.focusResourceIn(sessionId, "browser", tabId);
  const active = pane.activeTab?.resource;
  const activeBrowserId =
    active?.kind === "extension"
      ? browserData(active.resource)?.browserTabId
      : undefined;
  const previewTab =
    tabs.find((tab) => tab.browserTabId === activeBrowserId) ?? tabs[0];
  const others = tabs.filter(
    (tab) => tab.browserTabId !== previewTab.browserTabId,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => open(previewTab.browserTabId)}
        className="group relative overflow-hidden rounded-lg border border-border/60 text-left"
      >
        <PreviewWebview url={previewTab.url} />
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5 text-[10px] text-white">
          {previewTab.favicon ? (
            <img
              src={previewTab.favicon}
              alt=""
              className="size-3 shrink-0 rounded-sm"
            />
          ) : (
            <Globe2 className="size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {previewTab.title || previewTab.url}
          </span>
        </span>
      </button>
      {expanded &&
        others.map((tab) => (
          <button
            key={tab.browserTabId}
            type="button"
            onClick={() => open(tab.browserTabId)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
          >
            {tab.favicon ? (
              <img
                src={tab.favicon}
                alt=""
                className="size-4 shrink-0 rounded-sm"
              />
            ) : (
              <Globe2 className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {tab.title || tab.url}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {tab.url}
              </span>
            </span>
          </button>
        ))}
      {others.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="self-start px-2 py-1 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded
            ? t("embeddedBrowser.summary.collapse")
            : t("embeddedBrowser.summary.expand")}
        </button>
      )}
    </div>
  );
}

const browserSummary: WorkbenchSummaryContribution = {
  id: "amiba.browser.summary",
  order: 100,
  label: () =>
    browserMessages[
      document.documentElement.lang.startsWith("zh") ? "zh-CN" : "en"
    ]["embeddedBrowser.title"],
  component: BrowserSummary,
};

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
  const disposeView = ctx.slots.inject("amiba.workbench.view", () =>
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
  const disposeSummary = ctx.slots.inject("amiba.workbench.summary", () =>
    ctx.slots.register(
      {
        name: "amiba.workbench.summary",
        id: browserSummary.id,
        order: browserSummary.order,
        inject: () => ({ extension: browserSummary }),
      },
      () => null,
    ),
  );
  cleanup = () => {
    disposeView();
    disposeSummary();
  };
}
