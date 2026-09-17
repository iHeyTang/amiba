import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  ArrowRightLeft,
  Globe2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  type EmbeddedBrowserAdapter,
  type EmbeddedBrowserPageState,
} from "../shared/browser.js";
import { useBrowserT } from "./locales.js";

import { cn } from "@amiba/dsh-plugin-ui-shell/client";

import { useBrowserAdapter } from "./adapter.js";
import { CookieImportPanel } from "./CookieImportPanel.js";
import { useCookieImportT } from "./cookie-import-locales.js";

export interface EmbeddedBrowserResource {
  kind: "browser";
  browserTabId: string;
  url: string;
  address: string;
  title: string;
  favicon?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  error?: string;
}

export function createEmbeddedBrowserResource(
  browserTabId = globalThis.crypto?.randomUUID?.() ??
    `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): EmbeddedBrowserResource {
  return {
    kind: "browser",
    browserTabId,
    url: "about:blank",
    address: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  };
}

function pageStatePatch(
  state: EmbeddedBrowserPageState,
): Partial<EmbeddedBrowserResource> {
  const url = state.url || "about:blank";
  return {
    url,
    address: url === "about:blank" ? "" : url,
    title: state.title || "",
    canGoBack: Boolean(state.can_go_back),
    canGoForward: Boolean(state.can_go_forward),
    loading: Boolean(state.loading),
    error: undefined,
  };
}

type WebViewElement = HTMLElement & {
  getWebContentsId(): number;
};

function BrowserWebView({
  adapter,
  sessionId,
  tab,
  shown,
  onChange,
}: {
  adapter: EmbeddedBrowserAdapter;
  /** The chat session that owns this tab — reported to main on registration. */
  sessionId: string;
  tab: EmbeddedBrowserResource;
  /** Whether this tab is the one the visible workbench is showing. */
  shown: boolean;
  onChange(patch: Partial<EmbeddedBrowserResource>): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredRef = useRef(false);
  const activeRef = useRef(shown);
  const onChangeRef = useRef(onChange);
  activeRef.current = shown;
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const webview = document.createElement("webview") as WebViewElement;
    // `nodeintegration` and `allowpopups` are Electron BOOLEAN attributes:
    // presence is the value, so `setAttribute(name, "false")` turns them ON.
    // Electron reports `nodeintegration: true, allowpopups: true` for the
    // spelled-out-false form. Omitting them is the only way to say false.
    // `sandbox` and `contextIsolation` are not <webview> attributes at all and
    // were silently ignored — the guest's real webPreferences are enforced in
    // main's `will-attach-webview`, keyed on this partition.
    webview.setAttribute("src", tab.url || "about:blank");
    webview.setAttribute("partition", "persist:amiba-browser");
    webview.style.width = "100%";
    webview.style.height = "100%";
    webview.style.minWidth = "0";
    webview.style.minHeight = "0";
    webview.style.flex = "1 1 auto";
    webview.style.border = "0";
    // Electron's WebView host is itself a flex container. Keeping that
    // display mode is required so its internal guest iframe tracks the host
    // element whenever the workbench opens, resizes, or switches tabs.
    webview.style.display = "flex";

    const update = (patch: Partial<EmbeddedBrowserResource>) =>
      onChangeRef.current(patch);
    const onDomReady = () => {
      registeredRef.current = true;
      void adapter
        .registerTab({
          tabId: tab.browserTabId,
          webContentsId: webview.getWebContentsId(),
          active: activeRef.current,
          sessionId: sessionId || undefined,
        })
        .then((state) => update(pageStatePatch(state)))
        .catch((cause) =>
          update({
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
    };
    const onStartLoading = () => update({ loading: true, error: undefined });
    const onStopLoading = () => update({ loading: false });
    const onNavigate = (event: Event & { url?: string }) => {
      const url = event.url || "about:blank";
      update({
        url,
        address: url === "about:blank" ? "" : url,
        error: undefined,
      });
    };
    const onTitle = (event: Event & { title?: string }) =>
      update({ title: event.title ?? "" });
    const onFavicon = (event: Event & { favicons?: string[] }) =>
      update({ favicon: event.favicons?.[0] });
    const onFail = (
      event: Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      },
    ) => {
      if (event.isMainFrame === false || event.errorCode === -3) return;
      update({
        loading: false,
        error:
          event.errorDescription ||
          `Unable to load ${event.validatedURL || "the page"}`,
      });
    };

    webview.addEventListener("dom-ready", onDomReady);
    webview.addEventListener("did-start-loading", onStartLoading);
    webview.addEventListener("did-stop-loading", onStopLoading);
    webview.addEventListener("did-navigate", onNavigate as EventListener);
    webview.addEventListener(
      "did-navigate-in-page",
      onNavigate as EventListener,
    );
    webview.addEventListener("page-title-updated", onTitle as EventListener);
    webview.addEventListener(
      "page-favicon-updated",
      onFavicon as EventListener,
    );
    webview.addEventListener("did-fail-load", onFail as EventListener);
    container.appendChild(webview);

    return () => {
      registeredRef.current = false;
      void adapter.unregisterTab(tab.browserTabId).catch(() => {});
      try {
        container.removeChild(webview);
      } catch {
        // The parent may already be gone while Electron is shutting down.
      }
    };
    // Deliberately keyed on the tab alone: `sessionId` is fixed for the life
    // of a tab, and re-running this would tear the <webview> down and reload
    // the page.
  }, [adapter, tab.browserTabId]);

  useEffect(() => {
    if (!shown || !registeredRef.current) return;
    void adapter.setActiveTab(tab.browserTabId).catch(() => {});
  }, [shown, adapter, tab.browserTabId]);

  return (
    <div
      ref={containerRef}
      aria-hidden={!shown}
      data-embedded-browser-tab={tab.browserTabId}
      className={cn(
        "absolute inset-0 bg-white",
        shown ? "pointer-events-auto visible" : "pointer-events-none invisible",
      )}
    />
  );
}

/**
 * A browser tab plus the session that owns it.
 *
 * The host mounts tabs from EVERY session, so it needs both halves: the tab
 * id addresses the `<webview>`, the session id is what main keys ownership on.
 */
export interface SessionBrowserTab {
  sessionId: string;
  resource: EmbeddedBrowserResource;
}

export interface BrowserViewportRegistry {
  /** Publish the rectangle the shown `<webview>` should cover, or `null`. */
  register(element: HTMLElement | null): void;
}

export const BrowserViewportContext = createContext<BrowserViewportRegistry>({
  register: () => {},
});

/**
 * A second viewport the summary popover publishes: it wants the ACTIVE tab's
 * webview rendered small (scaled) inside its preview card, so the preview and
 * the workbench share the one live webview instead of reloading a duplicate.
 * Module-level (not React context) because the summary card lives outside the
 * browser host's context tree.
 */
export interface SummaryPreviewViewport {
  element: HTMLElement;
  sessionId: string;
  tabId: string;
}
let summaryPreview: SummaryPreviewViewport | null = null;
const summaryPreviewListeners = new Set<() => void>();
export const summaryPreviewViewport = {
  register(next: SummaryPreviewViewport | null): void {
    if (
      summaryPreview?.element === next?.element &&
      summaryPreview?.tabId === next?.tabId
    ) {
      return;
    }
    summaryPreview = next;
    for (const listener of summaryPreviewListeners) listener();
  },
  subscribe(listener: () => void): () => void {
    summaryPreviewListeners.add(listener);
    return () => {
      summaryPreviewListeners.delete(listener);
    };
  },
  getSnapshot(): SummaryPreviewViewport | null {
    return summaryPreview;
  },
};

/** Where a `<webview>` parks while no workbench is showing it. */
const OFFSCREEN_LEFT_PX = -20_000;
const OFFSCREEN_SIZE = { width: 1280, height: 800 };
/**
 * How long the position keeps tracking after something moves it. The
 * workbench opens, resizes and slides on CSS transitions, so one measurement
 * is never enough — but a permanent rAF loop would wake the compositor every
 * frame for nothing.
 */
const POSITION_SETTLE_MS = 700;

/**
 * The one place `<webview>`s live.
 *
 * Tabs used to be mounted by the workbench, which only ever renders the
 * VISIBLE session — so a background task could not get a tab registered at
 * all, and main's five-second wait timed out. The host mounts one `<webview>`
 * per browser tab across every session's pane record and keeps it mounted:
 * re-parenting a `<webview>` reloads its page, so the workbench never adopts
 * one. It publishes the rectangle it wants filled and the host positions the
 * shown tab over it; every other tab stays parked offscreen at a real size,
 * so a background page still has a sane viewport to be driven in.
 */
const noSubscription = () => () => {};
const emptyViewport = () => null;

export function EmbeddedBrowserHost({
  tabs,
  shownSessionId,
  shownTabId,
  onUpdateTab,
  children,
  viewportSource,
}: {
  viewportSource?: {
    subscribe(listener: () => void): () => void;
    getSnapshot(): HTMLElement | null;
  };
  tabs: readonly SessionBrowserTab[];
  /** The session whose workbench is on screen. */
  shownSessionId: string;
  /** The browser tab that workbench is showing, or null. */
  shownTabId: string | null;
  onUpdateTab(
    sessionId: string,
    browserTabId: string,
    patch: Partial<EmbeddedBrowserResource>,
  ): void;
  children?: ReactNode;
}) {
  const adapter = useBrowserAdapter();
  const frameRef = useRef<HTMLDivElement>(null);
  const [localViewport, setViewport] = useState<HTMLElement | null>(null);
  const sharedViewport = useSyncExternalStore(
    viewportSource?.subscribe ?? noSubscription,
    viewportSource?.getSnapshot ?? emptyViewport,
    emptyViewport,
  );
  const viewport = viewportSource ? sharedViewport : localViewport;
  const registry = useMemo<BrowserViewportRegistry>(
    () => ({ register: setViewport }),
    [],
  );

  const shown = tabs.find(
    (tab) =>
      tab.sessionId === shownSessionId &&
      tab.resource.browserTabId === shownTabId,
  );
  const summaryPreview = useSyncExternalStore(
    summaryPreviewViewport.subscribe,
    summaryPreviewViewport.getSnapshot,
    () => null as SummaryPreviewViewport | null,
  );
  // A blank tab must not cover the workbench's own empty state.
  const workbenchShown =
    shown !== undefined && shown.resource.url !== "about:blank";
  // The workbench wins the live webview while it is actually showing the
  // browser; otherwise the summary preview shows the active tab scaled down.
  const shownBrowserTabId = workbenchShown
    ? shown.resource.browserTabId
    : (summaryPreview?.tabId ?? null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof requestAnimationFrame !== "function") return;
    let handle = 0;
    let deadline = 0;
    // The first measurement must apply even when the viewport was removed.
    // Otherwise the previous on-screen position keeps covering import UI.
    let last: string | null = null;
    const apply = () => {
      let left = OFFSCREEN_LEFT_PX;
      let top = 0;
      let width = OFFSCREEN_SIZE.width;
      let height = OFFSCREEN_SIZE.height;
      let scale = 1;
      if (workbenchShown && viewport) {
        const rect = viewport.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) {
          left = rect.left;
          top = rect.top;
          width = rect.width;
          height = rect.height;
        }
      } else if (summaryPreview) {
        const rect = summaryPreview.element.getBoundingClientRect();
        if (rect.width > 1 && rect.height > 1) {
          left = rect.left;
          top = rect.top;
          width = OFFSCREEN_SIZE.width;
          height = OFFSCREEN_SIZE.height;
          scale = rect.width / OFFSCREEN_SIZE.width;
        }
      }
      const next = `${Math.round(left)},${Math.round(top)},${Math.round(width)},${Math.round(height)},${scale}`;
      if (next === last) return;
      last = next;
      frame.style.left = `${left}px`;
      frame.style.top = `${top}px`;
      frame.style.width = `${width}px`;
      frame.style.height = `${height}px`;
      frame.style.transform = scale === 1 ? "none" : `scale(${scale})`;
      frame.style.transformOrigin = "top left";
    };
    const tick = () => {
      apply();
      if (Date.now() > deadline) {
        handle = 0;
        return;
      }
      handle = requestAnimationFrame(tick);
    };
    const schedule = () => {
      deadline = Date.now() + POSITION_SETTLE_MS;
      if (!handle) handle = requestAnimationFrame(tick);
    };
    apply();
    schedule();
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    if (viewport) observer?.observe(viewport);
    if (summaryPreview) observer?.observe(summaryPreview.element);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (handle) cancelAnimationFrame(handle);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [viewport, summaryPreview, workbenchShown, shownBrowserTabId, tabs.length]);

  return (
    <BrowserViewportContext.Provider value={registry}>
      {children}
      {adapter ? (
        <div
          ref={frameRef}
          data-embedded-browser-host
          // The layer covers the workbench's own preview area, so it must not
          // swallow clicks meant for what is painted under it (the blank-tab
          // empty state, for one). Only the shown <webview> takes input.
          className="pointer-events-none fixed overflow-hidden"
          style={{
            left: OFFSCREEN_LEFT_PX,
            top: 0,
            width: OFFSCREEN_SIZE.width,
            height: OFFSCREEN_SIZE.height,
            zIndex: "var(--z-workbench)" as unknown as number,
          }}
        >
          {tabs.map((tab) => (
            <BrowserWebView
              key={tab.resource.browserTabId}
              adapter={adapter}
              sessionId={tab.sessionId}
              tab={tab.resource}
              shown={tab.resource.browserTabId === shownBrowserTabId}
              onChange={(patch) =>
                onUpdateTab(tab.sessionId, tab.resource.browserTabId, patch)
              }
            />
          ))}
          {shown?.resource.error && shown.resource.url !== "about:blank" ? (
            <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-destructive/20 bg-background/95 px-3 py-2 text-[10.5px] text-destructive shadow-sm backdrop-blur">
              {shown.resource.error}
            </div>
          ) : null}
        </div>
      ) : null}
    </BrowserViewportContext.Provider>
  );
}

export function EmbeddedBrowserToggle({
  open,
  onToggle,
  className,
}: {
  open: boolean;
  onToggle(): void;
  className?: string;
}) {
  const { t } = useBrowserT();
  if (!useBrowserAdapter()) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      title={open ? t("embeddedBrowser.close") : t("embeddedBrowser.open")}
      aria-label={open ? t("embeddedBrowser.close") : t("embeddedBrowser.open")}
      aria-pressed={open}
      className={cn(
        "app-no-drag relative inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-foreground/5 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        open && "bg-foreground/5 text-foreground",
        className,
      )}
    >
      <Globe2 className="h-3.5 w-3.5" />
    </button>
  );
}

export function EmbeddedBrowserWorkspace({
  tabs,
  activeTabId,
  visible,
  onUpdateTab,
  onNewTab,
  className,
}: {
  tabs: EmbeddedBrowserResource[];
  activeTabId: string | null;
  /**
   * Whether this workbench is actually showing the browser. The `<webview>`
   * is positioned over the viewport published below, so a closed or
   * mode-switched workbench must publish nothing at all — its element still
   * has a rectangle even when the pane is slid shut.
   */
  visible: boolean;
  onUpdateTab(
    browserTabId: string,
    patch: Partial<EmbeddedBrowserResource>,
  ): void;
  onNewTab(): void;
  className?: string;
}) {
  const adapter = useBrowserAdapter();
  const { t } = useBrowserT();
  const viewportRegistry = useContext(BrowserViewportContext);
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const { t: importT } = useCookieImportT();
  const [agentAction, setAgentAction] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected] = useState(false);
  const [devServers, setDevServers] = useState<
    Array<{ url: string; port: number }>
  >([]);
  const addressRef = useRef<HTMLInputElement>(null);
  const activeTab =
    tabs.find((tab) => tab.browserTabId === activeTabId) ?? null;

  const updateTab = useCallback(
    (browserTabId: string, patch: Partial<EmbeddedBrowserResource>) =>
      onUpdateTab(browserTabId, patch),
    [onUpdateTab],
  );

  useEffect(() => {
    if (!adapter) return;
    return adapter.onAgentActivity((event) => {
      if (event.tabId !== activeTabId) return;
      setAgentAction(event.running ? event.action : null);
    });
  }, [activeTabId, adapter]);

  useEffect(() => {
    if (!adapter || !activeTab || importOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void adapter.command(activeTab.browserTabId, { action: "reload" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, adapter, importOpen]);

  const navigate = useCallback(
    async (tab: EmbeddedBrowserResource, address: string) => {
      if (!adapter || !address.trim()) return;
      updateTab(tab.browserTabId, {
        address,
        loading: true,
        error: undefined,
      });
      try {
        const state = await adapter.command(tab.browserTabId, {
          action: "navigate",
          url: address,
        });
        updateTab(tab.browserTabId, pageStatePatch(state));
      } catch (cause) {
        updateTab(tab.browserTabId, {
          loading: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [adapter, updateTab],
  );

  useEffect(() => {
    const register = viewportRegistry.register;
    register(visible && !importOpen ? viewportNode : null);
    return () => register(null);
  }, [viewportRegistry, viewportNode, visible, importOpen]);

  const detect = async () => {
    if (!adapter || detecting) return;
    setDetecting(true);
    try {
      const servers = await adapter.detectDevServers();
      setDetected(true);
      setDevServers(servers);
      if (servers.length === 1 && activeTab) {
        void navigate(activeTab, servers[0]!.url);
      }
    } finally {
      setDetecting(false);
    }
  };

  if (!adapter) return null;

  return (
    <section
      data-embedded-browser-workspace
      aria-label={t("embeddedBrowser.title")}
      className={cn("absolute inset-0 flex min-h-0 flex-col", className)}
    >
      {activeTab ? (
        <form
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void navigate(activeTab, activeTab.address);
          }}
          className="flex h-11 shrink-0 items-center gap-1.5 px-3"
        >
          <button
            type="button"
            disabled={!activeTab.canGoBack}
            onClick={() =>
              void adapter.command(activeTab.browserTabId, { action: "back" })
            }
            title={t("embeddedBrowser.back")}
            aria-label={t("embeddedBrowser.back")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground disabled:opacity-30"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!activeTab.canGoForward}
            onClick={() =>
              void adapter.command(activeTab.browserTabId, {
                action: "forward",
              })
            }
            title={t("embeddedBrowser.forward")}
            aria-label={t("embeddedBrowser.forward")}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground disabled:opacity-30"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() =>
              void adapter.command(activeTab.browserTabId, {
                action: activeTab.loading ? "stop" : "reload",
              })
            }
            title={
              activeTab.loading
                ? t("embeddedBrowser.stop")
                : t("common.refresh")
            }
            aria-label={
              activeTab.loading
                ? t("embeddedBrowser.stop")
                : t("common.refresh")
            }
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          >
            {activeTab.loading ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
          </button>
          <div className="relative min-w-0 flex-1">
            <Globe2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              ref={addressRef}
              value={activeTab.address}
              onChange={(event) =>
                updateTab(activeTab.browserTabId, {
                  address: event.target.value,
                })
              }
              placeholder={t("embeddedBrowser.addressPlaceholder")}
              aria-label={t("embeddedBrowser.addressPlaceholder")}
              spellCheck={false}
              className="h-8 w-full rounded-full border-0 bg-muted/60 pl-9 pr-4 text-center text-[11px] text-foreground outline-none transition-[background-color,box-shadow] placeholder:text-muted-foreground/65 focus:bg-muted/80 focus:shadow-[0_0_0_2px_hsl(var(--ring)/0.18)]"
            />
          </div>
          {agentAction ? (
            <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-sky-500/8 px-2 text-[9.5px] font-medium text-sky-700 dark:text-sky-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
              {t("embeddedBrowser.agentOperating")}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onNewTab}
            title={t("embeddedBrowser.newTab")}
            aria-label={t("embeddedBrowser.newTab")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!activeTab.url || activeTab.url === "about:blank"}
            onClick={() => void adapter.openExternal(activeTab.url)}
            title={t("embeddedBrowser.openExternal")}
            aria-label={t("embeddedBrowser.openExternal")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground disabled:opacity-30"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          {adapter.cookieImport && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              title={importT("title")}
              aria-label={importT("title")}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </form>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {importOpen && adapter.cookieImport && (
          <CookieImportPanel
            importer={adapter.cookieImport}
            onClose={() => setImportOpen(false)}
            onVisit={(domain) => {
              setImportOpen(false);
              if (activeTab) void navigate(activeTab, `https://${domain}`);
            }}
          />
        )}
        {/*
         * The rectangle `EmbeddedBrowserHost` positions the shown `<webview>`
         * over. The webviews themselves are mounted once, outside the
         * workbench, so a background session can register its tab and so that
         * switching tabs never re-parents (and thus reloads) a live page.
         */}
        <div
          ref={setViewportNode}
          data-embedded-browser-viewport
          className="absolute inset-0"
        />

        {activeTab?.url === "about:blank" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background px-8 text-center">
            <div className="max-w-sm">
              <Globe2 className="mx-auto h-8 w-8 stroke-[1.5] text-muted-foreground/55" />
              <h2 className="mt-4 text-sm font-medium text-foreground">
                {t("embeddedBrowser.emptyTitle")}
              </h2>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                {t("embeddedBrowser.emptyDescription")}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
                <span className="text-muted-foreground/70">
                  {t("embeddedBrowser.previewPrompt")}
                </span>
                <button
                  type="button"
                  onClick={() => void detect()}
                  className="font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                  disabled={detecting}
                >
                  {detecting
                    ? t("embeddedBrowser.detecting")
                    : t("embeddedBrowser.detectDevServer")}
                </button>
              </div>
              {devServers.length > 1 ? (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {devServers.map((server) => (
                    <button
                      key={server.url}
                      type="button"
                      onClick={() => void navigate(activeTab, server.url)}
                      className="rounded-md bg-muted/65 px-2 py-1 font-mono text-[10px] text-foreground hover:bg-muted"
                    >
                      localhost:{server.port}
                    </button>
                  ))}
                </div>
              ) : null}
              {detected && !detecting && devServers.length === 0 ? (
                <p className="mt-2 text-[10px] text-muted-foreground/70">
                  {t("embeddedBrowser.noDevServer")}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
