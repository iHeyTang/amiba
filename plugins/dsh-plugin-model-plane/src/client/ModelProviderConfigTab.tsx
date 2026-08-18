import {
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelIcon,
  ModelIdentityName,
  ModelInfoCard,
  ModelPickerDialog,
  ModelSettingsSectionHeader,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  cn,
  usePluginT,
  type ModelMetadata,
  type ModelPickerGroup,
} from "@amiba/ui/plugin";

import type {
  AgentModelSelectionShape as AgentModelSelection,
  ModelDefinitionShape as ModelDefinition,
  ModelPlaneSnapshotShape as ModelPlaneSnapshot,
  ModelProviderProfileShape as ModelProviderProfile,
} from "../remote.js";
import { modelPlaneI18n } from "./i18n.js";

type ModelProviderProtocol = ModelProviderProfile["protocol"];

/**
 * The settings surface's view of the Model Plane. Local to the plugin — the
 * shape mirrors the plugin's own Remote face (`../remote.ts`), not the host
 * `PlatformAdapter` contract; `client/index.tsx` builds an instance directly
 * from `ctx.remote.amibaModelPlane`.
 */
export interface ModelPlaneAdapter {
  snapshot(): Promise<ModelPlaneSnapshot>;
  setDefaultSelection(
    selection: AgentModelSelection,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  upsert(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
    expectedRevision?: number;
  }): Promise<ModelPlaneSnapshot>;
  remove(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
  discover(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
  }): Promise<{ models: ModelDefinition[] }>;
  unsetCredential(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot>;
}

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`).
 * Every call site in this file should use this, not the bare `usePluginT`,
 * so overlay-covered keys resolve locally instead of depending on the host
 * `options.models.*` / `options.dshModels.*` bundles.
 */
function useT() {
  return usePluginT(modelPlaneI18n);
}

interface ProviderRow {
  provider: ModelProviderProfile;
  credential?: ModelPlaneSnapshot["credentials"][string];
}

function modelMetadata(model: ModelDefinition): ModelMetadata {
  return {
    ...(model.contextWindow ? { context_window: model.contextWindow } : {}),
    ...(model.maxTokens ? { max_output_tokens: model.maxTokens } : {}),
    ...(model.inputModalities?.length
      ? { input_modalities: model.inputModalities }
      : {}),
    ...(model.reasoning?.efforts.length ? { reasoning: true } : {}),
  };
}

function pickerGroups(snapshot: ModelPlaneSnapshot): ModelPickerGroup[] {
  return snapshot.providers
    .filter((provider) => provider.enabled)
    .map((provider) => ({
      id: `model-plane:${provider.id}`,
      label: provider.displayName,
      provider: provider.id,
      models: provider.models
        .filter((model) => model.enabled !== false)
        .map((model) => ({
          model: model.id,
          label: model.name,
          description: model.description,
          metadata: modelMetadata(model),
          keywords: model.reasoning?.efforts.flatMap((effort) => [
            effort.id,
            effort.name,
          ]),
        })),
    }))
    .filter((group) => group.models.length > 0);
}

function selectedModel(
  snapshot: ModelPlaneSnapshot,
): { provider: ModelProviderProfile; model: ModelDefinition } | null {
  const selection = snapshot.defaultSelection;
  if (!selection) return null;
  const provider = snapshot.providers.find(
    (candidate) => candidate.id === selection.provider,
  );
  const model = provider?.models.find(
    (candidate) => candidate.id === selection.model,
  );
  return provider && model ? { provider, model } : null;
}

function providerStatus(
  row: ProviderRow,
  t: ReturnType<typeof useT>["t"],
): { label: string; variant: "success" | "warning" | "outline" } {
  if (!row.provider.credentialRef) {
    return {
      label: t("options.dshModels.auth.native"),
      variant: "outline",
    };
  }
  if (row.credential?.configured) {
    return {
      label: t("options.dshModels.auth.configured"),
      variant: "success",
    };
  }
  return {
    label: t("options.dshModels.auth.missing"),
    variant: "warning",
  };
}

export function ModelProviderConfigTab({
  adapter,
}: {
  adapter: ModelPlaneAdapter;
}) {
  const { t } = useT();
  const [snapshot, setSnapshot] = useState<ModelPlaneSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await adapter.snapshot());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo<ProviderRow[]>(() => {
    if (!snapshot) return [];
    return snapshot.providers.map((provider) => ({
      provider,
      credential: provider.credentialRef
        ? snapshot.credentials[provider.credentialRef]
        : undefined,
    }));
  }, [snapshot]);

  const activeProvider = rows.find(
    (row) => row.provider.id === selectedProviderId,
  );

  async function setDefault(selection: AgentModelSelection) {
    if (!snapshot) return;
    setPending("default");
    setError(null);
    try {
      setSnapshot(
        await adapter.setDefaultSelection(selection, snapshot.revision),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(null);
    }
  }

  async function updateProvider(
    provider: ModelProviderProfile,
    pendingKey: string,
  ) {
    if (!snapshot) return;
    setPending(pendingKey);
    setError(null);
    try {
      setSnapshot(
        await adapter.upsert({
          provider,
          expectedRevision: snapshot.revision,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPending(null);
    }
  }

  if (loading && !snapshot) {
    return <ModelSettingsLoadingSkeleton />;
  }

  return (
    <div className="space-y-8">
      {snapshot ? (
        <DefaultModelPanel
          pending={pending === "default"}
          snapshot={snapshot}
          onSelect={(providerId, modelId) => {
            const model = snapshot.providers
              .find((provider) => provider.id === providerId)
              ?.models.find((candidate) => candidate.id === modelId);
            void setDefault({
              provider: providerId,
              model: modelId,
              ...(model?.reasoning?.defaultEffort
                ? { reasoningEffort: model.reasoning.defaultEffort }
                : {}),
            });
          }}
          onSelectEffort={(reasoningEffort) => {
            if (!snapshot.defaultSelection) return;
            void setDefault({
              ...snapshot.defaultSelection,
              reasoningEffort,
            });
          }}
        />
      ) : null}

      <ProviderServicesPanel
        loading={loading}
        pending={pending}
        rows={rows}
        selection={snapshot?.defaultSelection}
        onConfigure={(providerId) => setSelectedProviderId(providerId)}
        onModelEnabledChange={(provider, modelId, enabled) =>
          void updateProvider(
            {
              ...provider,
              models: provider.models.map((model) =>
                model.id === modelId ? { ...model, enabled } : model,
              ),
            },
            `model:${provider.id}:${modelId}`,
          )
        }
        onProviderEnabledChange={(provider, enabled) =>
          void updateProvider(
            { ...provider, enabled },
            `provider:${provider.id}`,
          )
        }
      />

      <Button
        className="h-8 gap-1.5 text-xs"
        disabled={!snapshot}
        onClick={() => setCreating(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("options.models.provider.addCustom")}
      </Button>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {snapshot?.failures.length ? (
        <section className={MODEL_SETTINGS_SECTION_CLASS}>
          <ModelSettingsSectionHeader
            title={t("options.dshModels.failures")}
          />
          <div className="space-y-2">
            {snapshot.failures.map((failure) => (
              <p
                className="rounded-lg bg-destructive/6 px-3 py-2 text-xs text-destructive"
                key={failure.id}
              >
                <span className="font-medium">{failure.name}</span>:{" "}
                {failure.message}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      {activeProvider && snapshot ? (
        <ProviderEditor
          adapter={adapter}
          onClose={() => setSelectedProviderId(null)}
          onSaved={(next) => {
            setSnapshot(next);
            setSelectedProviderId(null);
          }}
          row={activeProvider}
          snapshot={snapshot}
        />
      ) : null}
      {creating && snapshot ? (
        <CreateProviderDialog
          adapter={adapter}
          onClose={() => setCreating(false)}
          onSaved={(next) => {
            setCreating(false);
            setSnapshot(next);
          }}
          snapshot={snapshot}
        />
      ) : null}
    </div>
  );
}

function ModelSettingsLoadingSkeleton() {
  return (
    <div
      className="space-y-8 motion-safe:animate-pulse"
      data-model-settings-loading="models"
    >
      {[2, 4].map((rowCount) => (
        <section className="space-y-4" key={rowCount}>
          <span className="block h-3.5 w-28 rounded-full bg-muted/70" />
          <div className="overflow-hidden rounded-xl border border-border/60">
            {Array.from({ length: rowCount }, (_, index) => (
              <div
                className="flex h-14 items-center gap-3 border-b border-border/45 px-4 last:border-b-0"
                key={index}
              >
                <span className="h-4 w-4 rounded bg-muted/60" />
                <span className="h-3 min-w-0 flex-1 rounded-full bg-muted/45" />
                <span className="h-5 w-10 rounded-full bg-muted/55" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function DefaultModelPanel({
  pending,
  snapshot,
  onSelect,
  onSelectEffort,
}: {
  pending: boolean;
  snapshot: ModelPlaneSnapshot;
  onSelect: (provider: string, model: string) => void;
  onSelectEffort: (effort: string) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const selected = selectedModel(snapshot);
  const selection = snapshot.defaultSelection;
  const efforts = selected?.model.reasoning?.efforts ?? [];
  const effectiveEffort =
    selection?.reasoningEffort ?? selected?.model.reasoning?.defaultEffort;

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("options.models.config.defaultsTitle")}
      />
      <div className={MODEL_SETTINGS_SURFACE_CLASS} data-model-settings-surface>
        <div className="bg-background px-4 py-4">
          <button
            className={cn(
              "grid w-full items-center gap-3 text-left transition-opacity",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]",
            )}
            disabled={pending}
            onClick={() => setOpen(true)}
            type="button"
          >
            <span className="min-w-0">
              <span className="block text-xs font-medium text-foreground">
                {t("options.models.config.main")}
              </span>
            </span>
            <span
              className="flex min-w-0 items-center gap-2.5"
              data-model-slot-identity
            >
              {selected ? (
                <ModelIcon
                  className="h-5 w-5 shrink-0 text-muted-foreground"
                  model={selected.model.id}
                  provider={selected.provider.id}
                />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full border border-dashed border-muted-foreground/30" />
              )}
              <span className="min-w-0" data-model-slot-label>
                {selected ? (
                  <ModelIdentityName
                    className="flex"
                    displayName={selected.model.name}
                    model={selected.model.id}
                    variant="standard"
                  />
                ) : (
                  <span className="block truncate text-[10px] leading-none text-muted-foreground">
                    {t("options.models.config.mainUnset")}
                  </span>
                )}
              </span>
            </span>
            <span className="flex items-center justify-end gap-1.5">
              {pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : null}
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
            </span>
          </button>
        </div>

        {efforts.length > 1 ? (
          <div className="grid items-center gap-3 border-t border-border/60 bg-muted/[0.035] px-4 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
            <span className="text-xs font-medium text-foreground">
              {t("sidepanel.modelPicker.reasoningEffort")}
            </span>
            <Select
              disabled={pending}
              onValueChange={onSelectEffort}
              value={effectiveEffort}
            >
              <SelectTrigger
                aria-label={t("sidepanel.modelPicker.reasoningEffort")}
                className="h-8 w-full max-w-56 justify-between text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {efforts.map((effort) => (
                  <SelectItem key={effort.id} value={effort.id}>
                    {effort.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      <ModelPickerDialog
        description={t("options.models.config.pickerDescription")}
        groups={pickerGroups(snapshot)}
        onOpenChange={setOpen}
        onSelect={(provider, model) => {
          onSelect(provider, model);
          setOpen(false);
        }}
        open={open}
        saving={pending}
        searchPlaceholder={t("options.models.config.searchForTask", {
          task: t("options.models.config.main"),
        })}
        selected={selection}
        status="ready"
        title={t("options.models.config.pickerTitle", {
          task: t("options.models.config.main"),
        })}
      />
    </section>
  );
}

function ProviderServicesPanel({
  loading,
  pending,
  rows,
  selection,
  onConfigure,
  onModelEnabledChange,
  onProviderEnabledChange,
}: {
  loading: boolean;
  pending: string | null;
  rows: ProviderRow[];
  selection?: AgentModelSelection;
  onConfigure: (provider: string) => void;
  onModelEnabledChange: (
    provider: ModelProviderProfile,
    model: string,
    enabled: boolean,
  ) => void;
  onProviderEnabledChange: (
    provider: ModelProviderProfile,
    enabled: boolean,
  ) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRows = rows.filter(
    (row) =>
      !normalizedQuery ||
      row.provider.id.toLowerCase().includes(normalizedQuery) ||
      row.provider.displayName.toLowerCase().includes(normalizedQuery) ||
      row.provider.models.some(
        (model) =>
          model.id.toLowerCase().includes(normalizedQuery) ||
          model.name.toLowerCase().includes(normalizedQuery) ||
          model.description?.toLowerCase().includes(normalizedQuery),
      ),
  );

  function toggle(provider: string) {
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
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-9 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("options.models.display.search")}
            value={query}
          />
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-muted-foreground">
            {t("options.models.display.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {filteredRows.map((row) => {
              const provider = row.provider;
              const status = providerStatus(row, t);
              const isExpanded =
                expanded.has(provider.id) || normalizedQuery.length > 0;
              const isCurrent = selection?.provider === provider.id;
              const providerPending = pending === `provider:${provider.id}`;
              const models = normalizedQuery
                ? provider.models.filter(
                    (model) =>
                      model.id.toLowerCase().includes(normalizedQuery) ||
                      model.name.toLowerCase().includes(normalizedQuery) ||
                      model.description
                        ?.toLowerCase()
                        .includes(normalizedQuery),
                  )
                : provider.models;
              return (
                <li className="bg-background" key={provider.id}>
                  <div
                    className={cn(
                      "flex items-center gap-3 bg-muted/[0.14] px-3 py-2.5 transition-colors",
                      provider.enabled && "bg-muted/25",
                    )}
                    data-provider-row={provider.id}
                  >
                    <button
                      aria-expanded={isExpanded}
                      className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => toggle(provider.id)}
                      type="button"
                    >
                      {isExpanded ? (
                        <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <ModelIcon
                        className="mt-0.5 h-4 w-4 text-muted-foreground"
                        model=""
                        provider={provider.id}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-foreground">
                            {provider.displayName}
                          </span>
                          <Badge
                            className="rounded-full px-1.5 py-0 text-[9px] font-normal"
                            variant={status.variant}
                          >
                            {status.label}
                          </Badge>
                          {isCurrent ? (
                            <Badge
                              className="px-1.5 py-0 text-[9px] font-normal"
                              variant="secondary"
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
                        aria-label={t(
                          "options.models.display.configureProvider",
                          { name: provider.displayName },
                        )}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => onConfigure(provider.id)}
                        size="icon"
                        type="button"
                        variant="ghost"
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                      <Switch
                        aria-label={t("options.models.display.providerToggle", {
                          name: provider.displayName,
                        })}
                        checked={provider.enabled}
                        disabled={
                          providerPending || isCurrent || !provider.editable
                        }
                        onCheckedChange={(enabled) =>
                          onProviderEnabledChange(provider, enabled)
                        }
                      />
                    </div>
                  </div>

                  {isExpanded ? (
                    <ul className="divide-y divide-border/45 border-t border-border/40 bg-background">
                      {models.length ? (
                        models.map((model) => {
                          const current =
                            isCurrent && selection?.model === model.id;
                          return (
                            <li
                              className="bg-background pl-8 transition-colors hover:bg-muted/[0.12]"
                              data-model-row={model.id}
                              key={model.id}
                            >
                              <ModelDefinitionCard
                                action={
                                  <Switch
                                    aria-label={t(
                                      "options.models.display.modelToggle",
                                      { name: model.name },
                                    )}
                                    checked={
                                      provider.enabled &&
                                      model.enabled !== false
                                    }
                                    disabled={
                                      current ||
                                      !provider.enabled ||
                                      !provider.editable ||
                                      pending ===
                                        `model:${provider.id}:${model.id}`
                                    }
                                    onCheckedChange={(enabled) =>
                                      onModelEnabledChange(
                                        provider,
                                        model.id,
                                        enabled,
                                      )
                                    }
                                  />
                                }
                                className="rounded-none border-0 bg-transparent px-3 py-2.5"
                                current={current}
                                model={model}
                                provider={provider.id}
                                visible={
                                  provider.enabled && model.enabled !== false
                                }
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
    </section>
  );
}

function ModelDefinitionCard({
  action,
  className,
  current,
  model,
  provider,
  visible,
}: {
  action?: React.ReactNode;
  className?: string;
  current?: boolean;
  model: ModelDefinition;
  provider: string;
  visible?: boolean;
}) {
  const { t } = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const metadata = modelMetadata(model);
  return (
    <>
      <ModelInfoCard
        action={
          <span className="flex items-center gap-1.5">
            <Button
              aria-label={t("options.models.details.openFor", {
                name: model.id,
              })}
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => setDetailsOpen(true)}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Info className="h-3.5 w-3.5" />
            </Button>
            {action}
          </span>
        }
        className={className}
        current={current}
        description={model.name !== model.id ? model.name : undefined}
        metadata={metadata}
        model={model.id}
        provider={provider}
        visible={visible}
      />
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent
          className="flex max-h-[82vh] flex-col gap-0 overflow-hidden p-0"
          size="lg"
        >
          <DialogHeader className="border-b border-border/60 px-5 py-4 pr-12">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/45">
                <ModelIcon
                  className="h-5 w-5"
                  model={model.id}
                  provider={provider}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <DialogTitle className="truncate text-sm">
                    {model.name}
                  </DialogTitle>
                  {model.name !== model.id ? (
                    <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                      {model.id}
                    </span>
                  ) : null}
                </div>
                {model.description ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {model.description}
                  </p>
                ) : null}
              </div>
            </div>
            <DialogDescription className="sr-only">
              {t("options.models.details.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto p-5">
            <ModelInfoCard
              className="border-0 bg-transparent p-0"
              metadata={metadata}
              model={model.id}
              provider={provider}
              showIdentity={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderEditor({
  adapter,
  row,
  snapshot,
  onClose,
  onSaved,
}: {
  adapter: ModelPlaneAdapter;
  row: ProviderRow;
  snapshot: ModelPlaneSnapshot;
  onClose: () => void;
  onSaved: (snapshot: ModelPlaneSnapshot) => void;
}) {
  const { t } = useT();
  const [displayName, setDisplayName] = useState(row.provider.displayName);
  const [baseURL, setBaseURL] = useState(row.provider.baseURL ?? "");
  const [protocol, setProtocol] = useState(row.provider.protocol);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState(row.provider.models);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = providerStatus(row, t);

  function editedProvider(): ModelProviderProfile {
    return {
      ...row.provider,
      displayName: displayName.trim() || row.provider.id,
      protocol,
      ...(baseURL.trim()
        ? { baseURL: baseURL.trim() }
        : { baseURL: undefined }),
      models,
    };
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await adapter.upsert({
          provider: editedProvider(),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          expectedRevision: snapshot.revision,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function discover() {
    setDiscovering(true);
    setError(null);
    try {
      const result = await adapter.discover({
        provider: editedProvider(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setModels(result.models);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDiscovering(false);
    }
  }

  async function remove() {
    if (row.provider.source !== "user") return;
    if (!window.confirm(t("options.dshModels.deleteConfirm"))) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await adapter.remove(row.provider.id, snapshot.revision));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function unsetCredential() {
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await adapter.unsetCredential(row.provider.id, snapshot.revision),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(85vh,52rem)] !flex flex-col gap-0 overflow-hidden p-0"
        data-provider-config-dialog
        size="lg"
      >
        <DialogHeader className="relative z-10 border-b border-border/60 px-5 py-3.5 pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-sm leading-5">
              <ModelIcon
                className="h-[18px] w-[18px] shrink-0 text-muted-foreground"
                model=""
                provider={row.provider.id}
              />
              <span className="truncate">{row.provider.displayName}</span>
            </DialogTitle>
            <Badge
              className="rounded-full px-1.5 py-0 text-[9px] font-normal"
              variant={status.variant}
            >
              {status.label}
            </Badge>
          </div>
        </DialogHeader>
        <ScrollArea className="h-0 min-h-0 flex-1" data-provider-config-scroll>
          <div className="space-y-5 p-6">
            {error ? (
              <p className="text-[11px] text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            {row.provider.credentialRef ? (
              <section className="space-y-3">
                <div className="space-y-1.5">
                  <Label
                    className="flex min-w-0 items-baseline justify-between gap-3"
                    htmlFor="model-provider-key"
                  >
                    <span>{t("options.models.provider.credentialValue")}</span>
                    <span className="min-w-0 truncate font-mono text-[9px] font-normal text-muted-foreground/70">
                      {row.provider.credentialRef}
                    </span>
                  </Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      autoComplete="off"
                      className="h-8 pl-8 font-mono text-xs"
                      id="model-provider-key"
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={
                        row.credential?.configured
                          ? t("options.dshModels.keepCredential")
                          : t("options.models.provider.credentialPlaceholder")
                      }
                      type="password"
                      value={apiKey}
                    />
                  </div>
                </div>
                {row.credential?.configured && row.credential.writable ? (
                  <Button
                    className="h-7 text-xs"
                    disabled={saving}
                    onClick={() => void unsetCredential()}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {t("common.delete")}
                  </Button>
                ) : null}
              </section>
            ) : null}

            <button
              className="flex w-full items-center gap-1.5 border-t border-border pt-5 text-left text-xs font-medium"
              onClick={() => setAdvanced((value) => !value)}
              type="button"
            >
              {advanced ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {t("options.dshModels.displayName")} /{" "}
              {t("options.dshModels.baseURL")}
            </button>
            {advanced ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="model-provider-name">
                    {t("options.dshModels.displayName")}
                  </Label>
                  <Input
                    disabled={!row.provider.editable}
                    id="model-provider-name"
                    onChange={(event) => setDisplayName(event.target.value)}
                    value={displayName}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("options.dshModels.protocol")}</Label>
                  <ProviderProtocolSelect
                    disabled={row.provider.source !== "user"}
                    onChange={setProtocol}
                    value={protocol}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="model-provider-url">
                    {t("options.dshModels.baseURL")}
                  </Label>
                  <Input
                    disabled={!row.provider.editable}
                    id="model-provider-url"
                    onChange={(event) => setBaseURL(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    value={baseURL}
                  />
                </div>
              </div>
            ) : null}

            <section className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  {t("options.models.provider.models")}
                </h3>
                {row.provider.protocol !== "provider-native" ? (
                  <Button
                    className="h-7 shrink-0 gap-1.5 text-xs"
                    disabled={discovering}
                    onClick={() => void discover()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {discovering ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    {t("common.refresh")}
                  </Button>
                ) : null}
              </div>
              {models.length ? (
                <div className="rounded-lg border border-border bg-background">
                  <ul className="divide-y divide-border/50">
                    {models.map((model) => (
                      <li
                        className="transition-colors hover:bg-muted/[0.12]"
                        key={model.id}
                      >
                        <ModelDefinitionCard
                          className="rounded-none border-0 bg-transparent px-3 py-2.5"
                          model={model}
                          provider={row.provider.id}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border/80 bg-muted/15 p-4">
                  <p className="text-xs text-muted-foreground">
                    {t("options.models.provider.noModels")}
                  </p>
                </div>
              )}
            </section>

            <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
              {row.provider.source === "user" ? (
                <Button
                  disabled={saving}
                  onClick={() => void remove()}
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("common.delete")}
                </Button>
              ) : (
                <span />
              )}
              <Button
                disabled={saving || !row.provider.editable}
                onClick={() => void save()}
                type="button"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {t("common.save")}
              </Button>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function ProviderProtocolSelect({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean;
  onChange: (value: ModelProviderProtocol) => void;
  value: ModelProviderProtocol;
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(next) => onChange(next as ModelProviderProtocol)}
      value={value}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="deepseek-chat-completions">
          DeepSeek Chat Completions
        </SelectItem>
        <SelectItem value="openai-completions">OpenAI Completions</SelectItem>
        <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
        <SelectItem value="anthropic-messages">Anthropic Messages</SelectItem>
        <SelectItem value="provider-native">Provider Native</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CreateProviderDialog({
  adapter,
  snapshot,
  onClose,
  onSaved,
}: {
  adapter: ModelPlaneAdapter;
  snapshot: ModelPlaneSnapshot;
  onClose: () => void;
  onSaved: (snapshot: ModelPlaneSnapshot) => void;
}) {
  const { t } = useT();
  const [provider, setProvider] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [protocol, setProtocol] =
    useState<ModelProviderProtocol>("openai-completions");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const id = provider.trim();
    if (!/^[a-z][a-z0-9_-]*$/u.test(id)) {
      setError(t("options.dshModels.invalidProviderId"));
      return;
    }
    if (!baseURL.trim() || !model.trim()) {
      setError(t("options.dshModels.requiredProviderFields"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(
        await adapter.upsert({
          provider: {
            id,
            displayName: displayName.trim() || id,
            protocol,
            baseURL: baseURL.trim(),
            credentialRef: `${id.toUpperCase().replace(/[^A-Z0-9_]/gu, "_")}_API_KEY`,
            enabled: true,
            editable: true,
            source: "user",
            models: [{ id: model.trim(), name: model.trim() }],
          },
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          expectedRevision: snapshot.revision,
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t("options.models.provider.addCustom")}</DialogTitle>
          <DialogDescription>
            {t("options.dshModels.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="model-new-provider">
              {t("options.dshModels.providerId")}
            </Label>
            <Input
              id="model-new-provider"
              onChange={(event) => setProvider(event.target.value)}
              value={provider}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-new-name">
              {t("options.dshModels.displayName")}
            </Label>
            <Input
              id="model-new-name"
              onChange={(event) => setDisplayName(event.target.value)}
              value={displayName}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="model-new-url">
              {t("options.dshModels.baseURL")}
            </Label>
            <Input
              id="model-new-url"
              onChange={(event) => setBaseURL(event.target.value)}
              value={baseURL}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("options.dshModels.protocol")}</Label>
            <ProviderProtocolSelect onChange={setProtocol} value={protocol} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="model-new-model">
              {t("options.dshModels.initialModel")}
            </Label>
            <Input
              id="model-new-model"
              onChange={(event) => setModel(event.target.value)}
              value={model}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="model-new-key">
              {t("options.dshModels.apiKey")}
            </Label>
            <Input
              autoComplete="off"
              id="model-new-key"
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              value={apiKey}
            />
          </div>
        </div>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={saving}
            onClick={onClose}
            type="button"
            variant="ghost"
          >
            {t("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={() => void save()} type="button">
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t("options.models.provider.addCustom")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
