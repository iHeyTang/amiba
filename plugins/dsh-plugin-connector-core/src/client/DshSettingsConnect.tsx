import { Cable, CircleAlert, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  cn,
  Input,
  PageContent,
  ScrollArea,
  SettingsPageDescription,
  usePluginT,
} from "@amiba/ui/plugin";

import { AddConnectModal } from "./AddConnectModal.js";
import type { ConnectAdapter } from "./adapter.js";
import { ConnectorDetailPage, DetailStatus } from "./ConnectorDetailPage.js";
import { ConnectAccountPage } from "./ConnectAccountPage.js";
import { describeError } from "./describe-error.js";
import { connectI18n } from "./i18n.js";
import { useConnectorUIProviderIds } from "./connector-ui-registry.js";
import type {
  ConnectorUIRegistry,
  PresetOption,
} from "./connector-ui-registry.js";
import type { ConnectorProviderView, ConnectView } from "../types.js";

/** The connection plugin owns its own copy and settings shell. */
function useT() {
  return usePluginT(connectI18n);
}

type ConnectorDirectoryFilter = "all" | "connected" | "unconnected";

export interface DshSettingsConnectProps {
  renderAccess?(recordId: string): import("react").ReactNode;
  adapter: ConnectAdapter;
  registry: ConnectorUIRegistry;
  loadPresets: () => Promise<PresetOption[]>;
}

export function DshSettingsConnect({
  renderAccess,
  adapter,
  registry,
  loadPresets,
}: DshSettingsConnectProps) {
  const { t } = useT();
  // Membership subscription, called for its re-render: a provider plugin's
  // client half registers its wizard from its own `apply` and disposes it when
  // the plugin unloads, either of which can happen while this page is already
  // mounted. Without it the `registry.get` reads below (row icons) and the
  // picker inside `AddConnectModal` would stay frozen at their mount-time view.
  const wizardProviderIds = useConnectorUIProviderIds(registry);
  const [providers, setProviders] = useState<ConnectorProviderView[]>([]);
  const [connects, setConnects] = useState<ConnectView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingProviderId, setAddingProviderId] = useState<string | null>(null);
  const [detailProviderId, setDetailProviderId] = useState<string | null>(null);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [directoryFilter, setDirectoryFilter] =
    useState<ConnectorDirectoryFilter>("all");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [presets, setPresets] = useState<PresetOption[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextProviders, nextConnects] = await Promise.all([
        adapter.listProviders(),
        adapter.list(),
      ]);
      setProviders(nextProviders);
      setConnects(nextConnects);
      setError(null);
    } catch (cause) {
      setError(describeError(t, cause));
    } finally {
      setLoading(false);
    }
  }, [adapter, t]);

  useEffect(() => {
    void refresh();
    // Only re-run when the adapter identity changes; `t` is stable enough
    // per render and re-running on every locale switch would refetch data
    // that never changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  // Presets are loaded lazily, the first time a provider flow opens — not on
  // every mount — since fetching them costs a round trip nobody needs until
  // the user actually starts adding a connect.
  useEffect(() => {
    if (!addingProviderId && !accountId) return;
    let cancelled = false;
    void loadPresets().then((list) => {
      if (!cancelled) setPresets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [addingProviderId, accountId, loadPresets]);

  const account = connects.find((item) => item.id === accountId);

  const connectCountByProvider = useMemo(() => {
    const counts = new Map<string, number>();
    for (const connect of connects) {
      counts.set(connect.provider, (counts.get(connect.provider) ?? 0) + 1);
    }
    return counts;
  }, [connects]);

  const directoryCounts = useMemo(
    () => ({
      all: providers.length,
      connected: providers.filter(
        (provider) => (connectCountByProvider.get(provider.id) ?? 0) > 0,
      ).length,
      unconnected: providers.filter(
        (provider) => (connectCountByProvider.get(provider.id) ?? 0) === 0,
      ).length,
    }),
    [connectCountByProvider, providers],
  );

  const visibleProviders = useMemo(() => {
    const needle = directoryQuery.trim().toLocaleLowerCase();
    return providers.filter((provider) => {
      const connectCount = connectCountByProvider.get(provider.id) ?? 0;
      if (directoryFilter === "connected" && connectCount === 0) return false;
      if (directoryFilter === "unconnected" && connectCount > 0) return false;
      if (!needle) return true;
      const connectNames = connects
        .filter((connect) => connect.provider === provider.id)
        .map((connect) => connect.name)
        .join(" ");
      const tagline = registry.get(provider.id)?.tagline ?? "";
      return `${provider.name} ${provider.description} ${tagline} ${connectNames}`
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [
    connectCountByProvider,
    connects,
    directoryFilter,
    directoryQuery,
    providers,
    registry,
    wizardProviderIds,
  ]);

  const detailProvider = detailProviderId
    ? providers.find((provider) => provider.id === detailProviderId)
    : undefined;
  const detailConnects = detailProvider
    ? connects.filter((connect) => connect.provider === detailProvider.id)
    : [];

  const directoryFilters: Array<{
    id: ConnectorDirectoryFilter;
    label: string;
  }> = [
    { id: "all", label: t("options.connect.dsh.directory.filter.all") },
    {
      id: "connected",
      label: t("options.connect.dsh.directory.filter.connected"),
    },
    {
      id: "unconnected",
      label: t("options.connect.dsh.directory.filter.unconnected"),
    },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <PageContent bodyClassName="space-y-8" className="pt-3" size="lg">
          {detailProvider || account ? null : (
            <SettingsPageDescription className="max-w-2xl">
              {t("options.connect.dsh.description")}
            </SettingsPageDescription>
          )}

          {error ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
              role="alert"
            >
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
            </div>
          ) : null}

          {loading && !connects.length && !providers.length ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("options.connect.dsh.loading")}
            </div>
          ) : account ? (
            <ConnectAccountPage
              key={account.id}
              adapter={adapter}
              connect={account}
              accessPanel={renderAccess?.(account.id)}
              entry={registry.get(account.provider)}
              provider={providers.find((item) => item.id === account.provider)}
              presets={presets}
              onBack={() => {
                setAccountId(null);
                setDetailProviderId(account.provider);
              }}
              onChanged={refresh}
              onRemoved={() => setAccountId(null)}
            />
          ) : detailProvider ? (
            <ConnectorDetailPage
              canAdd={wizardProviderIds.includes(detailProvider.id)}
              connects={detailConnects}
              entry={registry.get(detailProvider.id)}
              onOpenAccount={setAccountId}
              onAdd={() => setAddingProviderId(detailProvider.id)}
              onBack={() => setDetailProviderId(null)}
              provider={detailProvider}
            />
          ) : (
            <>
              <section
                aria-labelledby="connector-directory-title"
                className="space-y-4"
              >
                <h2
                  className="text-[15px] font-semibold tracking-[-0.01em]"
                  id="connector-directory-title"
                >
                  {t("options.connect.dsh.directory.title")}
                </h2>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-56 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
                    <Input
                      aria-label={t("options.connect.dsh.directory.search")}
                      className="h-9 pl-9 text-sm"
                      onChange={(event) =>
                        setDirectoryQuery(event.target.value)
                      }
                      placeholder={t("options.connect.dsh.directory.search")}
                      value={directoryQuery}
                    />
                  </div>
                  <div
                    aria-label={t("options.connect.dsh.directory.filter.label")}
                    className="flex items-center gap-1"
                    role="group"
                  >
                    {directoryFilters.map((filter) => (
                      <button
                        aria-pressed={directoryFilter === filter.id}
                        className={cn(
                          "h-8 rounded-md px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          directoryFilter === filter.id
                            ? "bg-muted/65 font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                        )}
                        key={filter.id}
                        onClick={() => setDirectoryFilter(filter.id)}
                        type="button"
                      >
                        {filter.label}
                        <span className="ml-1.5 tabular-nums opacity-60">
                          {directoryCounts[filter.id]}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {providers.length === 0 ? (
                  <DirectoryState
                    description={t("options.connect.dsh.noProviders")}
                    title={t("options.connect.dsh.directory.empty")}
                  />
                ) : visibleProviders.length === 0 ? (
                  <DirectoryState
                    description={t(
                      "options.connect.dsh.directory.noResultsDescription",
                    )}
                    title={t("options.connect.dsh.directory.noResults")}
                  />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {visibleProviders.map((provider) => {
                      const entry = registry.get(provider.id);
                      return (
                        <ConnectorDirectoryCard
                          canAdd={wizardProviderIds.includes(provider.id)}
                          connectCount={
                            connectCountByProvider.get(provider.id) ?? 0
                          }
                          description={entry?.tagline ?? provider.description}
                          icon={entry?.icon}
                          key={provider.id}
                          onAdd={() => setAddingProviderId(provider.id)}
                          onOpenDetails={() => setDetailProviderId(provider.id)}
                          provider={provider}
                        />
                      );
                    })}
                  </div>
                )}
              </section>

              <section
                aria-labelledby="connected-accounts-title"
                className="space-y-4"
              >
                <h2
                  className="flex items-baseline gap-2 text-[15px] font-semibold tracking-[-0.01em]"
                  id="connected-accounts-title"
                >
                  {t("options.connect.dsh.accounts.title")}
                  <span className="text-[13px] font-normal tabular-nums text-muted-foreground">
                    {connects.length}
                  </span>
                </h2>

                {connects.length ? (
                  <div className="space-y-1">
                    {connects.map((connect) => (
                      <button
                        key={connect.id}
                        type="button"
                        onClick={() => setAccountId(connect.id)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ProviderLogo
                          icon={registry.get(connect.provider)?.icon}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {connect.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {providers.find(
                              (item) => item.id === connect.provider,
                            )?.name ?? connect.provider}
                          </span>
                        </span>
                        <DetailStatus status={connect.status} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg bg-muted/20 px-4 py-7 text-center">
                    <p className="text-sm text-muted-foreground">
                      {t("options.connect.dsh.empty")}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </PageContent>
      </ScrollArea>

      <AddConnectModal
        adapter={adapter}
        onCreated={() => {
          setAddingProviderId(null);
          void refresh();
        }}
        onOpenChange={(open) => {
          if (!open) {
            setAddingProviderId(null);
            void refresh();
          }
        }}
        open={addingProviderId !== null}
        presets={presets}
        providerId={addingProviderId}
        registry={registry}
      />
    </div>
  );
}

function DirectoryState({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-lg bg-muted/20 px-4 py-7 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>
    </div>
  );
}

function ProviderLogo({ icon }: { icon?: ReactNode }) {
  return icon ? (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center [&>img]:h-full [&>img]:w-full [&>svg]:h-full [&>svg]:w-full"
      data-provider-logo=""
    >
      {icon}
    </span>
  ) : (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground">
      <Cable className="h-[18px] w-[18px]" />
    </span>
  );
}

function ConnectorDirectoryCard({
  canAdd,
  connectCount,
  description,
  icon,
  onAdd,
  onOpenDetails,
  provider,
}: {
  canAdd: boolean;
  connectCount: number;
  description: string;
  icon?: ReactNode;
  onAdd(): void;
  onOpenDetails(): void;
  provider: ConnectorProviderView;
}) {
  const { t } = useT();
  const addLabel =
    connectCount > 0
      ? t("options.connect.dsh.directory.addAnother", {
          provider: provider.name,
        })
      : t("options.connect.dsh.directory.addAccount", {
          provider: provider.name,
        });
  const detailLabel = t("options.connect.dsh.directory.viewDetails", {
    provider: provider.name,
  });
  return (
    <article
      className="group grid min-h-[5.5rem] grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-lg bg-transparent px-3 py-3 transition-colors hover:bg-muted/35 focus-within:bg-muted/35"
      data-connector-provider={provider.id}
    >
      <button
        aria-label={detailLabel}
        className="flex min-w-0 items-start gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpenDetails}
        type="button"
      >
        <ProviderLogo icon={icon} />
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold">
              {provider.name}
            </span>
            {connectCount > 0 ? (
              <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">
                {t("options.connect.dsh.directory.accountCount", {
                  count: connectCount,
                })}
              </span>
            ) : null}
          </span>
          <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
            {description}
          </span>
          {!canAdd ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("options.connect.dsh.directory.setupUnavailable")}
            </span>
          ) : null}
        </span>
      </button>
      <button
        aria-label={addLabel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!canAdd}
        onClick={onAdd}
        type="button"
      >
        <Plus className="h-4 w-4" />
      </button>
    </article>
  );
}
