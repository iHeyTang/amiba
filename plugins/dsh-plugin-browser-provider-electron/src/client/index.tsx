import { browserMessages, useBrowserT } from "./locales.js";
import { ChevronDown, Globe2 } from "lucide-react";
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
  cn,
  getPlatform,
  useWorkspacePane,
} from "@amiba/dsh-plugin-ui-shell/client";
import {
  BrowserViewportContext,
  EmbeddedBrowserHost,
  EmbeddedBrowserWorkspace,
  createEmbeddedBrowserResource,
  summaryPreviewViewport,
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

/** Card width/height, matching the summary panel's width and a 16:10 preview. */
const PREVIEW_CARD_WIDTH = 280;
const PREVIEW_CARD_HEIGHT = 175;

/**
 * The browser card of the pinned summary. It does NOT host its own webview:
 * it publishes a transparent viewport and the browser host parks the ACTIVE
 * tab's live webview over it (scaled), so the preview stays in sync with the
 * workbench and never reloads. Other tabs sit in a bordered text card behind
 * an expand toggle.
 */
function BrowserSummary({ sessionId }: { sessionId: string }) {
  const pane = useWorkspacePane();
  const adapter = useBrowserAdapter();
  const { t } = useBrowserT();
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const tabs = pane.resources
    .filter((entry) => entry.sessionId === sessionId)
    .flatMap((entry) => {
      const data = browserData(entry.resource);
      return data ? [data] : [];
    });
  if (tabs.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-background p-3 text-xs text-muted-foreground">
        {t("embeddedBrowser.summary.empty")}
      </div>
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

  // Publish the preview viewport so the host parks the active tab's live
  // webview here (scaled); release it on unmount.
  useEffect(() => {
    summaryPreviewViewport.register(
      previewRef.current && previewTab.url !== "about:blank"
        ? {
            element: previewRef.current,
            sessionId,
            tabId: previewTab.browserTabId,
          }
        : null,
    );
    return () => summaryPreviewViewport.register(null);
  }, [previewTab, sessionId]);

  // Stream the tab's rendered frames for the preview. The frame subscription
  // captures the page at its real size regardless of the workbench state, so
  // the card keeps a live, correctly-scaled picture whether or not the
  // workbench is open. The scaled live-webview fallback is unreliable (it
  // renders blank and bleeds past the card's rounded corners), so the frame is
  // the single source of truth for the preview.
  useEffect(() => {
    if (!adapter || !previewTab || previewTab.url === "about:blank") {
      return;
    }
    let disposed = false;
    let streaming = false;
    const unsubscribe = adapter.onFrame(previewTab.browserTabId, (next) => {
      if (!disposed) setFrame(next.data);
    });
    const start = () => {
      if (streaming || disposed) return;
      streaming = true;
      void adapter.startFrameStream(
        previewTab.browserTabId,
        PREVIEW_CARD_WIDTH * 2,
      );
    };
    const stop = () => {
      if (!streaming || disposed) return;
      streaming = false;
      void adapter.stopFrameStream(previewTab.browserTabId).catch(() => {});
    };
    // The frame stream forces the previewed page to keep producing frames and
    // encodes ~10 JPEGs per second in the main process. When the window is
    // hidden or backgrounded nobody is looking at the preview, so stop the
    // stream (and restart it on visibility) instead of paying for it for as
    // long as the summary panel happens to stay open.
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      stop();
      setFrame(null);
    };
  }, [adapter, previewTab]);

  return (
    <div className="flex flex-col gap-2">
      {/* Transparent window over the live webview. Other tabs peek out behind
          it as a stacked deck so multiple tabs read as one cascade. */}
      <div className="relative">
        {others.length > 0 &&
          others
            .slice(0, 2)
            .reverse()
            .map((tab, index) => (
              <div
                key={tab.browserTabId}
                aria-hidden
                className="absolute inset-0 rounded-xl border border-border/40 bg-background"
                style={{
                  transform: `translate(${(index + 1) * 6}px, ${-(index + 1) * 5}px)`,
                }}
              />
            ))}
        <button
          type="button"
          onClick={() => open(previewTab.browserTabId)}
          className="group relative w-full overflow-hidden rounded-xl text-left shadow-lg"
          style={{ height: PREVIEW_CARD_HEIGHT }}
        >
          {/* The viewport the host positions the scaled webview over. */}
          <div ref={previewRef} className="absolute inset-0" />
          {frame ? (
            <img
              src={`data:image/jpeg;base64,${frame}`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-top"
            />
          ) : null}
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/50 via-black/15 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white">
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
      </div>
      {/* Other tabs: an expandable list whose header hints at the content with
          a stacked favicon row and a tab count, and toggles on a chevron. */}
      {others.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border/60 bg-background">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-muted/50"
          >
            <span className="flex shrink-0 -space-x-1.5" aria-hidden>
              {others.slice(0, 3).map((tab) =>
                tab.favicon ? (
                  <img
                    key={tab.browserTabId}
                    src={tab.favicon}
                    alt=""
                    className="size-4 rounded-full bg-background ring-2 ring-background"
                  />
                ) : (
                  <span
                    key={tab.browserTabId}
                    className="flex size-4 items-center justify-center rounded-full bg-muted ring-2 ring-background"
                  >
                    <Globe2 className="size-2.5 text-muted-foreground" />
                  </span>
                ),
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
              {expanded
                ? t("embeddedBrowser.summary.collapse")
                : t("embeddedBrowser.summary.expand")}
              {!expanded && (
                <span className="text-muted-foreground/60">
                  {" "}
                  · {others.length}
                </span>
              )}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
                expanded && "rotate-180",
              )}
            />
          </button>
          {expanded && (
            <div className="border-t border-border/50 p-1">
              {others.map((tab) => (
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
            </div>
          )}
        </div>
      )}
    </div>
  );
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
  const adapter = createBrowserAdapter(bridge, lease);
  const browserView = createBrowserView(adapter);
  const browserSummary: WorkbenchSummaryContribution = {
    id: "amiba.browser.summary",
    order: 100,
    component: ({ sessionId }) => (
      <BrowserAdapterContext.Provider value={adapter}>
        <BrowserSummary sessionId={sessionId} />
      </BrowserAdapterContext.Provider>
    ),
  };
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
