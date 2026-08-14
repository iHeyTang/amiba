import {
  desktopBridge,
  useExtensionRegistry,
} from "@amiba/extension-host/renderer";
import {
  extensionManifestContributions,
  type ExtensionContributionKind,
} from "@amiba/extension-api";
import type {
  ExtensionRegistryItem,
  ExtensionsBridge,
} from "@amiba/extension-host/preload";
import { useT } from "@amiba/i18n";
import {
  AlertTriangle,
  AppWindow,
  AtSign,
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  PackageOpen,
  Play,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";

import { resolveExtensionIcon } from "../chat/Sidebar";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  PageContent,
  cn,
} from "../primitives";
import { SettingsPaneHeader } from "./SettingsPaneHeader";
import {
  ManagedExtensionCreateDialog,
  ManagedExtensions,
  type ManagedExtensionView,
} from "./ManagedExtensions";
import { useManagedExtensions, useStartAgentTask } from "./agent-task";

type ExtensionManifest = NonNullable<ExtensionRegistryItem["manifest"]>;

function getExtensions(): ExtensionsBridge {
  return desktopBridge().extensions;
}

function extensionName(item: ExtensionRegistryItem): string {
  return item.manifest?.name ?? item.id;
}

function sourceLabel(
  item: ExtensionRegistryItem,
  t: ReturnType<typeof useT>["t"],
) {
  if (item.source === "local") return t("options.extensions.source.local");
  if (item.source === "marketplace") {
    return t("options.extensions.source.marketplace");
  }
  return t("options.extensions.source.bundled");
}

function statusLabel(
  item: ExtensionRegistryItem,
  t: ReturnType<typeof useT>["t"],
) {
  if (item.status === "failed") return t("options.extensions.status.failed");
  if (item.status === "incompatible") {
    return t("options.extensions.status.incompatible");
  }
  if (item.status === "disabled") {
    return t("options.extensions.status.disabled");
  }
  if (item.status === "registered") {
    return t("options.extensions.status.registered");
  }
  return t("options.extensions.status.loaded");
}

function contributionLabel(
  kind: ExtensionContributionKind,
  t: ReturnType<typeof useT>["t"],
): string {
  const keys: Record<ExtensionContributionKind, Parameters<typeof t>[0]> = {
    main: "options.extensions.capability.main",
    settings: "options.extensions.capability.settings",
    mentions: "options.extensions.capability.mentions",
    "hermes-plugin": "options.extensions.capability.plugin",
    tools: "options.extensions.capability.tools",
    resources: "options.extensions.capability.resources",
  };
  return t(keys[kind]);
}

function ExtensionGlyph({
  manifest,
  size = "normal",
}: {
  manifest?: ExtensionManifest;
  size?: "normal" | "large";
}) {
  const resolved = manifest?.contributes?.main?.icon
    ? resolveExtensionIcon(manifest.contributes.main.icon)
    : null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-background text-foreground/75",
        size === "large"
          ? "h-12 w-12 rounded-xl [&_svg]:h-5 [&_svg]:w-5"
          : "h-10 w-10 [&_svg]:h-[18px] [&_svg]:w-[18px]",
      )}
    >
      {resolved ?? <Boxes />}
    </span>
  );
}

function ExtensionState({ item }: { item: ExtensionRegistryItem }) {
  const { t } = useT();
  if (item.status === "loaded") return null;

  const isError = item.status === "failed" || item.status === "incompatible";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        isError ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isError ? "bg-destructive" : "bg-muted-foreground/60",
        )}
      />
      {statusLabel(item, t)}
    </span>
  );
}

function ExtensionRow({
  item,
  onOpen,
}: {
  item: ExtensionRegistryItem;
  onOpen: () => void;
}) {
  const { t } = useT();
  const version = item.manifest?.version ?? item.version;
  const contributions = extensionManifestContributions(item.manifest).map(
    (kind) => contributionLabel(kind, t),
  );

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex min-h-[72px] w-full items-center gap-3 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-muted/35 focus-visible:bg-muted/45"
      >
        <ExtensionGlyph manifest={item.manifest} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">
              {extensionName(item)}
            </span>
            <ExtensionState item={item} />
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {[sourceLabel(item, t), version ? `v${version}` : null, ...contributions]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
      </button>
    </li>
  );
}

function DetailRow({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-full")}>
      <dt className="text-[11px] leading-none text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-2 min-w-0 break-all text-sm leading-5",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function CapabilityItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-lg bg-muted/45 px-2.5 py-1.5 text-xs text-muted-foreground">
      <span className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function ExtensionDetail({
  item,
  busy,
  onBack,
  onReload,
  onUninstall,
}: {
  item: ExtensionRegistryItem;
  busy: boolean;
  onBack: () => void;
  onReload: () => void;
  onUninstall: () => void;
}) {
  const { t } = useT();
  const manifest = item.manifest;
  const version = manifest?.version ?? item.version;
  const mentions = manifest?.mentions ?? [];
  const hermesPlugins = manifest?.hermesPlugins ?? [];
  const permissions = manifest?.permissions ?? [];
  const capabilities = [
    manifest?.contributes?.main
      ? {
          id: "main",
          icon: <AppWindow />,
          label: t("options.extensions.capability.main"),
        }
      : null,
    mentions.length > 0
      ? {
          id: "mentions",
          icon: <AtSign />,
          label: t("options.extensions.capability.mentions"),
        }
      : null,
    hermesPlugins.length > 0
      ? {
          id: "plugin",
          icon: <Bot />,
          label: t("options.extensions.capability.plugin"),
        }
      : null,
    permissions.some((permission) => permission.startsWith("hermes."))
      ? {
          id: "agent",
          icon: <Bot />,
          label: t("options.extensions.capability.agent"),
        }
      : null,
    manifest?.contributes?.settings
      ? {
          id: "settings",
          icon: <Settings2 />,
          label: t("options.extensions.capability.settings"),
        }
      : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <PageContent>
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 mb-5 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("options.extensions.title")}
        </button>

        <div className="flex min-w-0 items-center gap-3">
          <ExtensionGlyph manifest={manifest} size="large" />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-lg font-normal tracking-[-0.01em]">
              {extensionName(item)}
            </h1>
            {item.status === "loaded" ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--success))]" />
                {statusLabel(item, t)}
              </span>
            ) : (
              <ExtensionState item={item} />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.status !== "disabled" ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={onReload}
                aria-label={t("options.extensions.reload")}
                title={t("options.extensions.reload")}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted/55 hover:text-foreground [&_svg]:size-3.5"
              >
                <RefreshCw className={cn(busy && "animate-spin")} />
              </Button>
            ) : null}
            {item.source !== "bundled" ? (
              <Button
                variant="ghost"
                size="icon"
                disabled={busy}
                onClick={onUninstall}
                aria-label={t("options.extensions.uninstall")}
                title={t("options.extensions.uninstall")}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/[0.07] hover:text-destructive [&_svg]:size-3.5"
              >
                <Trash2 />
              </Button>
            ) : null}
          </div>
        </div>

        {capabilities.length > 0 ? (
          <ul
            aria-label={t("options.extensions.capabilities.title")}
            className="mt-5 flex flex-wrap gap-1.5"
          >
            {capabilities.map((capability) => (
              <CapabilityItem key={capability.id} icon={capability.icon}>
                {capability.label}
              </CapabilityItem>
            ))}
          </ul>
        ) : null}

        {item.error ? (
          <div
            className="mt-6 flex gap-2.5 rounded-xl bg-destructive/[0.055] px-3.5 py-3 text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-normal">
                {t("options.extensions.health.problem")}
              </p>
              <pre
                data-selection="text"
                className="mt-1 whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-destructive/85"
              >
                {item.error}
              </pre>
            </div>
          </div>
        ) : null}

        <section
          className="mt-6"
          aria-label={t("options.extensions.details.title")}
        >
          <dl className="grid grid-cols-1 gap-x-8 gap-y-5 rounded-xl bg-muted/25 px-4 py-3.5 sm:grid-cols-3">
            <DetailRow label="ID" mono>
              {item.id}
            </DetailRow>
            <DetailRow label={t("options.extensions.details.version")}>
              {version ? `v${version}` : "—"}
            </DetailRow>
            <DetailRow label={t("options.extensions.details.source")}>
              {sourceLabel(item, t)}
            </DetailRow>
            <DetailRow label={t("options.extensions.details.path")} mono wide>
              {item.path}
            </DetailRow>
          </dl>
        </section>

        {permissions.length > 0 ? (
          <section className="mt-7">
            <p className="text-xs text-muted-foreground">
              {t("options.extensions.permissions.title")}
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {permissions.map((permission) => (
                <li
                  key={permission}
                  className="rounded-lg bg-muted/40 px-2.5 py-1.5 font-mono text-xs"
                >
                  {permission}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {mentions.length > 0 ? (
          <section className="mt-7">
            <p className="text-xs text-muted-foreground">
              {t("options.extensions.mentions.title")}
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {mentions.map((mention) => (
                <li
                  key={mention.id}
                  className="flex items-center justify-between gap-5 rounded-lg bg-muted/25 px-3 py-2.5 text-sm"
                >
                  <span>@{mention.label}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {mention.provider}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hermesPlugins.length > 0 ? (
          <section className="mt-7">
            <p className="text-xs text-muted-foreground">
              {t("options.plugins.heading")}
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {hermesPlugins.map((plugin) => (
                <li
                  key={plugin.id}
                  className="flex items-center justify-between gap-5 rounded-lg bg-muted/25 px-3 py-2.5 text-sm"
                >
                  <span className="font-mono text-xs">
                    {plugin.id}
                    {plugin.version ? ` · ${plugin.version}` : ""}
                  </span>
                  {plugin.required ? (
                    <span className="text-xs text-muted-foreground">
                      {t("options.extensions.runtime.required")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageContent>
    </ScrollArea>
  );
}

export interface SettingsExtensionsHandle {
  add: () => Promise<void>;
  addLocal: () => Promise<void>;
  refresh: () => void;
}

export const SettingsExtensions = forwardRef<
  SettingsExtensionsHandle,
  {
    embedded?: boolean;
    onRefreshingChange?: (refreshing: boolean) => void;
    showPageTitle?: boolean;
    view?: ManagedExtensionView | null;
    onViewChange?: (view: ManagedExtensionView | null) => void;
  }
>(function SettingsExtensions(
  {
    embedded = false,
    onRefreshingChange,
    showPageTitle = false,
    view,
    onViewChange,
  },
  ref,
) {
  const { t } = useT();
  const managedExtensions = useManagedExtensions();
  const startAgentTask = useStartAgentTask();
  const [refreshKey, setRefreshKey] = useState(0);
  const [internalManagedView, setInternalManagedView] =
    useState<ManagedExtensionView | null>(null);
  const managedView = view === undefined ? internalManagedView : view;
  const setManagedView = onViewChange ?? setInternalManagedView;
  const {
    items,
    ready: registryReady,
    refreshing: registryRefreshing = false,
  } = useExtensionRegistry(refreshKey);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [addLocalError, setAddLocalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingUninstall, setPendingUninstall] =
    useState<ExtensionRegistryItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [managedRefreshKey, setManagedRefreshKey] = useState(0);

  useEffect(() => {
    return getExtensions().onExtensionsChanged(() =>
      setRefreshKey((key) => key + 1),
    );
  }, []);

  useEffect(() => {
    onRefreshingChange?.(registryRefreshing);
  }, [onRefreshingChange, registryRefreshing]);

  const selected = items.find((item) => item.id === selectedId);

  function refresh() {
    setRefreshKey((key) => key + 1);
    setManagedRefreshKey((key) => key + 1);
  }

  async function handleAddLocal() {
    setAddLocalError(null);
    const path = await getExtensions().pickFolder();
    if (!path) return;
    const result = await getExtensions().addLocal(path);
    if (!result.ok) {
      setAddLocalError(
        t("options.extensions.sideload.error", {
          error: result.error ?? "unknown",
        }),
      );
      return;
    }
    if (result.id) setSelectedId(result.id);
    refresh();
  }

  useImperativeHandle(ref, () => ({
    add: async () => {
      if (managedExtensions) setCreateOpen(true);
      else await handleAddLocal();
    },
    addLocal: handleAddLocal,
    refresh,
  }));

  async function handleReload(id: string) {
    setActionError(null);
    setBusy(id);
    try {
      const result = await getExtensions().reload(id);
      if (!result.ok) {
        setActionError(
          t("options.extensions.actionFailed", {
            error: result.error ?? "unknown",
          }),
        );
      }
      refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleUninstallConfirm() {
    if (!pendingUninstall) return;
    const item = pendingUninstall;
    setPendingUninstall(null);
    setActionError(null);
    setBusy(item.id);
    try {
      const result = await getExtensions().uninstall(item.id);
      if (!result.ok) {
        setActionError(
          t("options.extensions.actionFailed", {
            error: result.error ?? "unknown",
          }),
        );
      } else if (selectedId === item.id) {
        setSelectedId(null);
      }
      refresh();
    } finally {
      setBusy(null);
    }
  }

  const uninstallBody = pendingUninstall
    ? pendingUninstall.source === "local"
      ? t("options.extensions.uninstall.confirm.body.local", {
          name: extensionName(pendingUninstall),
          path: pendingUninstall.path,
        })
      : t("options.extensions.uninstall.confirm.body", {
          name: extensionName(pendingUninstall),
          id: pendingUninstall.id,
        })
    : "";

  return (
    <div className="flex h-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      {!embedded ? (
        <SettingsPaneHeader
          title={managedView?.name ?? t("options.extensions.title")}
          leading={managedView ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("options.extensions.title")}
              title={t("options.extensions.title")}
              onClick={() => setManagedView(null)}
              className="h-8 w-8 text-muted-foreground"
            >
              <ChevronLeft />
            </Button>
          ) : undefined}
          contentSize={managedView ? "full" : "md"}
          headerClassName={managedView ? "border-b border-border/60" : undefined}
        >
          {managedView ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setManagedView({
                ...managedView,
                mode: managedView.mode === "use" ? "manage" : "use",
              })}
            >
              {managedView.mode === "use" ? <Settings2 /> : <Play />}
              {managedView.mode === "use"
                ? t("options.extensions.managed.manage")
                : t("options.extensions.managed.use")}
            </Button>
          ) : !selected ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-busy={registryRefreshing}
                aria-label={t("options.extensions.refresh")}
                title={t("options.extensions.refresh")}
                onClick={refresh}
              >
                <RefreshCw
                  className={cn(registryRefreshing && "animate-spin")}
                />
              </Button>
              <Button size="sm" onClick={() => void handleAddLocal()}>
                <FolderOpen />
                {t("options.extensions.addLocal")}
              </Button>
            </div>
          ) : null}
        </SettingsPaneHeader>
      ) : null}

      {addLocalError || actionError ? (
        <div className="mx-6 mt-3 shrink-0 rounded-xl bg-destructive/[0.055] px-3.5 py-3 text-sm text-destructive">
          {addLocalError ?? actionError}
        </div>
      ) : null}

      {selected ? (
        <ExtensionDetail
          item={selected}
          busy={busy === selected.id}
          onBack={() => setSelectedId(null)}
          onReload={() => void handleReload(selected.id)}
          onUninstall={() => setPendingUninstall(selected)}
        />
      ) : managedExtensions ? (
        <ManagedExtensions
          bridge={managedExtensions}
          startAgentTask={startAgentTask}
          refreshToken={managedRefreshKey}
          onRefreshingChange={onRefreshingChange}
          view={managedView}
          onViewChange={setManagedView}
          showPageTitle={showPageTitle}
          installedItems={items}
          installedReady={registryReady}
          renderInstalledItem={(item) => (
            <ExtensionRow
              item={item}
              onOpen={() => setSelectedId(item.id)}
            />
          )}
        />
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <PageContent
            title={showPageTitle ? t("options.extensions.title") : undefined}
          >
            <>
                <div className="mb-2 flex items-center justify-between px-2 pb-1">
                  <h3 className="text-sm font-normal">
                    {t("options.extensions.tab.installed")}
                  </h3>
                  {items.length > 0 ? (
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  ) : null}
                </div>

                {!registryReady ? (
                  <ul
                    aria-label={t("common.loading")}
                    className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2"
                  >
                    {[0, 1, 2, 3].map((index) => (
                      <li
                        aria-hidden
                        className="flex min-h-[72px] animate-pulse items-center gap-3 px-2 py-3"
                        key={index}
                      >
                        <span className="h-10 w-10 shrink-0 rounded-[10px] bg-muted/60" />
                        <span className="min-w-0 flex-1 space-y-2">
                          <span className="block h-3 w-28 rounded-full bg-muted/60" />
                          <span className="block h-2.5 w-20 rounded-full bg-muted/45" />
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : items.length === 0 ? (
                  <div className="flex min-h-64 flex-col items-center justify-center text-center">
                    <PackageOpen className="h-7 w-7 text-muted-foreground/45" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t("options.extensions.empty.title")}
                    </p>
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
                    {items.map((item) => (
                      <ExtensionRow
                        key={item.id}
                        item={item}
                        onOpen={() => setSelectedId(item.id)}
                      />
                    ))}
                  </ul>
                )}
            </>
          </PageContent>
        </ScrollArea>
      )}

      <Dialog
        open={pendingUninstall !== null}
        onOpenChange={(open) => !open && setPendingUninstall(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("options.extensions.uninstall.confirm.title")}
            </DialogTitle>
            <DialogDescription>{uninstallBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingUninstall(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleUninstallConfirm()}
            >
              {t("options.extensions.uninstall")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {managedExtensions ? (
        <ManagedExtensionCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          bridge={managedExtensions}
          startAgentTask={startAgentTask}
        />
      ) : null}
    </div>
  );
});
