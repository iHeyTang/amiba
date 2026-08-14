import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  getPlatform,
  type EmbeddedBrowserAdapter,
  type EmbeddedBrowserPageState,
} from "@amiba/platform";
import { useT } from "@amiba/i18n";

import { cn } from "../primitives";

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
  tab,
  active,
  onChange,
}: {
  adapter: EmbeddedBrowserAdapter;
  tab: EmbeddedBrowserResource;
  active: boolean;
  onChange(patch: Partial<EmbeddedBrowserResource>): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const registeredRef = useRef(false);
  const activeRef = useRef(active);
  const onChangeRef = useRef(onChange);
  activeRef.current = active;
  onChangeRef.current = onChange;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const webview = document.createElement("webview") as WebViewElement;
    webview.setAttribute("src", tab.url || "about:blank");
    webview.setAttribute("nodeintegration", "false");
    webview.setAttribute("contextIsolation", "true");
    webview.setAttribute("sandbox", "true");
    webview.setAttribute("allowpopups", "false");
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
  }, [adapter, tab.browserTabId]);

  useEffect(() => {
    if (!active || !registeredRef.current) return;
    void adapter.setActiveTab(tab.browserTabId).catch(() => {});
  }, [active, adapter, tab.browserTabId]);

  return (
    <div
      ref={containerRef}
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 bg-white",
        active ? "visible" : "pointer-events-none invisible",
      )}
    />
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
  const { t } = useT();
  if (!getPlatform().embeddedBrowser) return null;
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
  onUpdateTab,
  onNewTab,
  className,
}: {
  tabs: EmbeddedBrowserResource[];
  activeTabId: string | null;
  onUpdateTab(
    browserTabId: string,
    patch: Partial<EmbeddedBrowserResource>,
  ): void;
  onNewTab(): void;
  className?: string;
}) {
  const adapter = getPlatform().embeddedBrowser;
  const { t } = useT();
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
    if (!adapter || !activeTab) return;
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
  }, [activeTab, adapter]);

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
            onClick={() => void getPlatform().shell.openExternal(activeTab.url)}
            title={t("embeddedBrowser.openExternal")}
            aria-label={t("embeddedBrowser.openExternal")}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/45 hover:text-foreground disabled:opacity-30"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
        </form>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {tabs.map((tab) => (
          <BrowserWebView
            key={tab.browserTabId}
            adapter={adapter}
            tab={tab}
            active={tab.browserTabId === activeTabId}
            onChange={(patch) => updateTab(tab.browserTabId, patch)}
          />
        ))}

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

        {activeTab?.error && activeTab.url !== "about:blank" ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20 rounded-lg border border-destructive/20 bg-background/95 px-3 py-2 text-[10.5px] text-destructive shadow-sm backdrop-blur">
            {activeTab.error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
