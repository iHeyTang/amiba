import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Settings } from "lucide-react";

import type {
  HermesModelProviderView,
  HermesProviderConnection,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import { ModelCatalogEntryCard, ModelIcon } from "../models";
import { Badge, Button, Input, Switch, cn } from "../primitives";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./ModelSettingsSectionChrome";
import { providerConnectionScopeLabel } from "./ProviderConnectionStatusBadge";

export interface ModelDisplayPanelProps {
  providers: HermesModelProviderView[];
  connections?: Record<string, HermesProviderConnection | undefined>;
  error?: string | null;
  loadError?: string | null;
  loading?: boolean;
  pending?: string | null;
  onProviderVisibilityChange: (
    provider: string,
    visible: boolean,
  ) => Promise<void> | void;
  onModelVisibilityChange: (
    provider: string,
    model: string,
    visible: boolean,
  ) => Promise<void> | void;
  onConfigureProvider: (provider: string) => void;
}

function sourceLabel(
  source: HermesModelProviderView["source"],
  t: ReturnType<typeof useT>["t"],
): string {
  switch (source) {
    case "config":
      return t("options.models.display.source.config");
    case "saved-credentials":
      return t("options.models.display.source.saved");
    case "detected-credentials":
      return t("options.models.display.source.detected");
    default:
      return t("options.models.display.source.available");
  }
}

function connectionLabel(
  provider: HermesModelProviderView,
  connection: HermesProviderConnection | undefined,
  t: ReturnType<typeof useT>["t"],
): string {
  if (connection) {
    return providerConnectionScopeLabel(connection, t);
  }
  return sourceLabel(provider.source, t);
}

function connectionBadgeVariant(
  provider: HermesModelProviderView,
  connection: HermesProviderConnection | undefined,
): "success" | "warning" | "destructive" | "outline" | "secondary" {
  if (connection?.status === "verified") return "success";
  if (
    connection?.status === "detected" ||
    connection?.status === "verification_required"
  ) {
    return "warning";
  }
  if (connection?.status === "unavailable") return "destructive";
  if (connection?.status === "configured") return "secondary";
  if (connection?.status === "none") return "outline";
  if (provider.source === "detected-credentials") return "warning";
  if (provider.explicitlyConfigured) return "secondary";
  return "outline";
}

/**
 * One auditable place for deciding what Amiba advertises in compact model
 * pickers. Provider connection signals stay visible beside the switch so an
 * ambient CLI login can never masquerade as an explicit Amiba configuration.
 */
export function ModelDisplayPanel({
  providers,
  connections = {},
  error,
  loadError,
  loading = false,
  pending,
  onProviderVisibilityChange,
  onModelVisibilityChange,
  onConfigureProvider,
}: ModelDisplayPanelProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const modelMatchesQuery = (
    model: HermesModelProviderView["models"][number],
  ) =>
    model.id.toLowerCase().includes(normalizedQuery) ||
    (model.description ?? "").toLowerCase().includes(normalizedQuery) ||
    JSON.stringify(model.metadata ?? {})
      .toLowerCase()
      .includes(normalizedQuery) ||
    JSON.stringify(model.supplemental ?? {})
      .toLowerCase()
      .includes(normalizedQuery);
  const serviceProviders = useMemo(
    () => providers.filter((provider) => provider.kind !== "virtual"),
    [providers],
  );

  const filteredProviders = useMemo(() => {
    if (!normalizedQuery) return serviceProviders;
    return serviceProviders.filter(
      (provider) =>
        provider.id.toLowerCase().includes(normalizedQuery) ||
        provider.label.toLowerCase().includes(normalizedQuery) ||
        provider.models.some(modelMatchesQuery),
    );
  }, [normalizedQuery, serviceProviders]);

  function toggleExpanded(provider: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  }

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader title={t("options.models.display.title")} />

      <div className={MODEL_SETTINGS_SURFACE_CLASS} data-model-settings-surface>
        <div className="flex items-center gap-2 border-b border-border/60 bg-muted/10 px-3">
          <Search aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("options.models.display.search")}
            className="h-9 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>

        {loading && serviceProviders.length === 0 ? (
          <div
            className="divide-y divide-border/45 motion-safe:animate-pulse"
            data-model-catalog-loading
          >
            {Array.from({ length: 4 }, (_, index) => (
              <div
                className="flex h-[3.75rem] items-center gap-3 px-3"
                key={index}
              >
                <span className="h-3.5 w-3.5 rounded bg-muted/70" />
                <span className="h-7 w-7 rounded-lg bg-muted/55" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-2.5 w-28 rounded-full bg-muted/70" />
                  <span className="block h-2 w-20 rounded-full bg-muted/45" />
                </span>
                <span className="h-5 w-10 rounded-full bg-muted/55" />
              </div>
            ))}
          </div>
        ) : loadError && serviceProviders.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {loadError}
          </p>
        ) : filteredProviders.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("options.models.display.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {filteredProviders.map((provider) => {
              const connection = connections[provider.id];
              const modelMatches = normalizedQuery
                ? provider.models.filter(modelMatchesQuery)
                : provider.models;
              const isExpanded =
                expanded.has(provider.id) ||
                (normalizedQuery.length > 0 && modelMatches.length > 0);
              const providerPending = pending === `provider:${provider.id}`;
              return (
                <li key={provider.id} className="bg-background">
                  <div
                    className={cn(
                      "flex items-center gap-3 bg-muted/[0.14] px-3 py-2.5 transition-colors",
                      provider.visible && "bg-muted/25",
                    )}
                    data-provider-row={provider.id}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpanded(provider.id)}
                    >
                      {isExpanded ? (
                        <ChevronDown
                          aria-hidden
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <ChevronRight
                          aria-hidden
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        />
                      )}
                      <ModelIcon
                        className="mt-0.5 h-4 w-4 text-muted-foreground"
                        model=""
                        provider={provider.id}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-foreground">
                            {provider.label}
                          </span>
                          <Badge
                            variant={connectionBadgeVariant(
                              provider,
                              connection,
                            )}
                            className="rounded-full px-1.5 py-0 text-[9px] font-normal"
                          >
                            {connectionLabel(provider, connection, t)}
                          </Badge>
                          {provider.current ? (
                            <Badge
                              variant="secondary"
                              className="px-1.5 py-0 text-[9px] font-normal"
                            >
                              {t("options.models.display.current")}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/75">
                          {provider.id} ·{" "}
                          {t("options.models.display.availableModels", {
                            count: provider.models.length,
                          })}
                        </p>
                      </div>
                    </button>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t(
                          "options.models.display.configureProvider",
                          { name: provider.label },
                        )}
                        title={t("options.models.display.configureProvider", {
                          name: provider.label,
                        })}
                        onClick={() => onConfigureProvider(provider.id)}
                      >
                        <Settings aria-hidden className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        checked={provider.visible}
                        disabled={
                          providerPending ||
                          provider.current ||
                          !provider.selectable
                        }
                        aria-label={t("options.models.display.providerToggle", {
                          name: provider.label,
                        })}
                        title={
                          provider.current
                            ? t("options.models.display.currentDescription")
                            : undefined
                        }
                        onCheckedChange={(visible) =>
                          void onProviderVisibilityChange(provider.id, visible)
                        }
                      />
                    </div>
                  </div>

                  {isExpanded ? (
                    <ul className="divide-y divide-border/45 border-t border-border/40 bg-background">
                      {modelMatches.length > 0 ? (
                        modelMatches.map((model) => {
                          const modelPending =
                            pending === `model:${provider.id}:${model.id}`;
                          return (
                            <li
                              key={model.id}
                              className="bg-background pl-8 transition-colors hover:bg-muted/[0.12]"
                              data-model-row={model.id}
                            >
                              <ModelCatalogEntryCard
                                action={
                                  <Switch
                                    checked={provider.visible && model.visible}
                                    disabled={
                                      modelPending ||
                                      model.current ||
                                      !provider.visible
                                    }
                                    aria-label={t(
                                      "options.models.display.modelToggle",
                                      { name: model.id },
                                    )}
                                    onCheckedChange={(visible) =>
                                      void onModelVisibilityChange(
                                        provider.id,
                                        model.id,
                                        visible,
                                      )
                                    }
                                  />
                                }
                                className="rounded-none border-0 bg-transparent px-3 py-2.5"
                                current={model.current}
                                entry={model}
                                provider={provider.id}
                                visible={provider.visible && model.visible}
                              />
                            </li>
                          );
                        })
                      ) : (
                        <li className="py-4 pl-11 pr-3 text-[10px] text-muted-foreground">
                          {t("options.models.display.noModels")}
                        </li>
                      )}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
