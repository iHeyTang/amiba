import {
  Check,
  ChevronDown,
  ChevronRight,
  Fingerprint,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, PageContent } from "../primitives";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../primitives";
import { Input } from "../primitives";
import { Label } from "../primitives";
import { ScrollArea } from "../primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../primitives";
import {
  ModelCatalogEntryCard,
  ModelIcon,
  ModelIdentityName,
  ModelPickerDialog,
  resolveCatalogModelDisplayName,
  type ModelPickerGroup,
  type ModelPickerStatus,
} from "../models";
import { useT } from "@amiba/i18n";

import { SettingsGateway } from "./SettingsGateway";
import type { BridgeCapability } from "./capabilities";
import {
  AUXILIARY_SLOT_NAMES,
  DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
  buildHermesModelPickerGroups,
  buildHermesModelProviderViews,
  buildHermesVirtualCapabilityPickerGroups,
  buildHermesVirtualCapabilityViews,
  hermesSelectedModelSummaryKey,
  hermesModelGateway,
  getHermesProfiles,
  type AuxiliaryModelsResponse,
  type AuxiliarySlotName,
  type AuxiliaryTask,
  type HermesAgentMainModelResponse,
  type HermesCatalogModelEntry,
  type HermesModelDisplayPreferences,
  type HermesModelCatalogResponse,
  type HermesMoaConfigResponse,
  type HermesProviderConnection,
  type HermesProviderCredentialField,
  type HermesProviderEndpointResolution,
  type HermesProfile,
  type HermesSelectedModelSummary,
} from "@amiba/core";
import { cn } from "../primitives";
import { ModelDisplayPanel } from "./ModelDisplayPanel";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./ModelSettingsSectionChrome";
import { ProviderConnectionStatusBadge } from "./ProviderConnectionStatusBadge";
import { ProviderCredentialEditor } from "./ProviderCredentialEditor";
import { VirtualCapabilitiesPanel } from "./VirtualCapabilitiesPanel";

export type HermesModelSettingsView =
  | "models"
  | "multi-model-collaboration"
  | "connection";

const AUXILIARY_SLOT_MESSAGE_KEYS = {
  vision: "options.models.config.slot.vision",
  web_extract: "options.models.config.slot.webExtract",
  compression: "options.models.config.slot.compression",
  session_search: "options.models.config.slot.sessionSearch",
  skills_hub: "options.models.config.slot.skillsHub",
  approval: "options.models.config.slot.approval",
  mcp: "options.models.config.slot.mcp",
  title_generation: "options.models.config.slot.titleGeneration",
} as const;

/** Build a name-indexed view of the upstream `tasks` array for render code. */
function tasksToMap(
  resp: AuxiliaryModelsResponse,
): Record<AuxiliarySlotName, AuxiliaryTask> | null {
  const arr = resp.tasks;
  if (!arr || arr.length === 0) return null;
  const map: Partial<Record<AuxiliarySlotName, AuxiliaryTask>> = {};
  for (const t of arr) map[t.task] = t;
  return map as Record<AuxiliarySlotName, AuxiliaryTask>;
}

function useDelayedLoading(active: boolean, delay = 180): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [active, delay]);
  return visible;
}

function LoadingBar({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={cn("block rounded-full bg-muted/70", className)}
    />
  );
}

function ProfileScopeControl({
  profiles,
  value,
  onChange,
}: {
  profiles: HermesProfile[];
  value: string;
  onChange: (profile: string) => void;
}) {
  const { t } = useT();
  if (!value) return null;
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger
        aria-label={t("options.agents.profiles")}
        className="h-7 w-auto max-w-48 gap-1.5 rounded-full border-border/60 bg-muted/20 px-2.5 text-[10px] shadow-none"
      >
        <Fingerprint
          aria-hidden
          className="h-3 w-3 shrink-0 text-muted-foreground"
        />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-44">
        {profiles.map((profile) => (
          <SelectItem key={profile.name} value={profile.name}>
            {profile.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ModelSettingsLoadingSkeleton({
  visible,
  view,
}: {
  visible: boolean;
  view: Exclude<HermesModelSettingsView, "connection">;
}) {
  if (!visible) return <div className="min-h-0 flex-1 bg-background" />;
  if (view === "multi-model-collaboration") {
    return (
      <div
        className="flex min-h-0 flex-1 bg-background motion-safe:animate-pulse"
        data-model-settings-loading="multi-model-collaboration"
      >
        <aside className="w-52 shrink-0 border-r border-border/60 bg-muted/10 p-3">
          <div className="mb-6 flex items-center justify-between">
            <LoadingBar className="h-3 w-20" />
            <LoadingBar className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <LoadingBar className="h-8 w-full rounded-md" />
            <LoadingBar className="h-8 w-4/5 rounded-md" />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <PageContent bodyClassName="space-y-5" size="md">
            <div className="h-12 rounded-xl border border-border/60 bg-muted/[0.08]" />
            <div className="space-y-2">
              <LoadingBar className="h-3 w-24" />
              <LoadingBar className="h-2.5 w-72 max-w-full" />
            </div>
            <div className="overflow-hidden rounded-xl border border-border/60">
              {[0, 1, 2].map((row) => (
                <div
                  className="grid h-[4.5rem] grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/45 px-4 last:border-b-0"
                  key={row}
                >
                  <LoadingBar className="h-2.5 w-20" />
                  <LoadingBar className="h-8 w-48 max-w-full rounded-lg" />
                  <LoadingBar className="h-5 w-12" />
                </div>
              ))}
            </div>
          </PageContent>
        </div>
      </div>
    );
  }
  return (
    <ScrollArea
      className="min-h-0 min-w-0 flex-1"
      data-model-settings-loading="models"
    >
      <PageContent
        bodyClassName="space-y-8 motion-safe:animate-pulse"
        size="md"
      >
        {[2, 4].map((rows, section) => (
          <section className="space-y-4" key={rows}>
            <LoadingBar className={section === 0 ? "h-3 w-28" : "h-3 w-24"} />
            <div className="overflow-hidden rounded-xl border border-border/60">
              {Array.from({ length: rows }, (_, row) => (
                <div
                  className="flex h-14 items-center gap-3 border-b border-border/45 px-4 last:border-b-0"
                  key={row}
                >
                  <LoadingBar className="h-4 w-4" />
                  <LoadingBar className="h-3 w-28" />
                  <LoadingBar className="ml-auto h-5 w-12" />
                </div>
              ))}
            </div>
          </section>
        ))}
      </PageContent>
    </ScrollArea>
  );
}

export function HermesModelConfigTab({
  bridge,
  view = "models",
  selectedProfileId,
  onSelectedProfileIdChange,
  showProfileScope = false,
  initialProviderId,
}: {
  /** Forwarded to the Connection section (SettingsGateway body). */
  bridge?: BridgeCapability;
  /** Settings owns top-level navigation; this component renders one pane. */
  view?: HermesModelSettingsView;
  /** Fix model reads and writes to this Profile. */
  selectedProfileId?: string;
  /** Optional legacy scope picker. Advanced agent settings should own scope. */
  onSelectedProfileIdChange?: (profileId: string) => void;
  /** Show the internal Profile picker. Hidden by default to avoid duplicate scope UI. */
  showProfileScope?: boolean;
  /** Open this provider's configuration dialog when the pane mounts. */
  initialProviderId?: string;
} = {}) {
  const { t } = useT();
  const [profiles, setProfiles] = useState<HermesProfile[]>([]);
  const [localProfileId, setLocalProfileId] = useState("");
  const profileId = selectedProfileId ?? localProfileId;
  const profileSelectionIsControlled = selectedProfileId !== undefined;
  const setProfileId = useCallback(
    (nextProfileId: string) => {
      if (!profileSelectionIsControlled) {
        setLocalProfileId(nextProfileId);
      }
      onSelectedProfileIdChange?.(nextProfileId);
    },
    [onSelectedProfileIdChange, profileSelectionIsControlled],
  );
  // ── Shared / catalog state ─────────────────────────────────────────────
  const [catalog, setCatalog] = useState<HermesModelCatalogResponse | null>(
    null,
  );
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  // ── Main-model state (disk only — no draft) ───────────────────────────
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [mainError, setMainError] = useState<string | null>(null);
  const [diskProvider, setDiskProvider] = useState("auto");
  const [diskModel, setDiskModel] = useState("");
  const [mainInfo, setMainInfo] = useState<HermesAgentMainModelResponse>({
    ok: true,
  });
  // ── Auxiliary-model state (8 named slots) ────────────────────────────
  // Bridge returns ``tasks: AuxiliaryTask[]`` matching upstream
  // `/api/model/auxiliary`. We index it by `task` name locally for fast
  // lookup in the per-slot render code — this is a *local view* of the
  // upstream-aligned response, not a wire-shape compat shim.
  const [auxSlots, setAuxSlots] = useState<Record<
    AuxiliarySlotName,
    AuxiliaryTask
  > | null>(null);
  const [auxError, setAuxError] = useState<string | null>(null);
  const [auxSavingSlot, setAuxSavingSlot] = useState<AuxiliarySlotName | null>(
    null,
  );
  const [auxSavedSlot, setAuxSavedSlot] = useState<AuxiliarySlotName | null>(
    null,
  );

  // ── Provider panel state ──────────────────────────────────────────────
  // The selected provider drives the configuration dialog.
  const [hProvider, setHProvider] = useState(
    () => initialProviderId?.trim() ?? "",
  );
  useEffect(() => {
    if (initialProviderId !== undefined) {
      setHProvider(initialProviderId.trim());
    }
  }, [initialProviderId, profileId]);
  const [hSaving, setHSaving] = useState(false);
  const [hSaved, setHSaved] = useState(false);
  const [hError, setHError] = useState<string | null>(null);
  const [providerCliModels, setProviderCliModels] = useState<
    HermesCatalogModelEntry[]
  >([]);
  const [providerCliLoading, setProviderCliLoading] = useState(false);
  const [providerCliMeta, setProviderCliMeta] = useState<{
    source?: string;
    cli_loaded?: boolean;
    pricing_loaded?: boolean;
  } | null>(null);
  /**
   * Per-provider credential cache. Keyed by slug. Once a provider's
   * fields/hint have been fetched they live here for the rest of the
   * session — reopening a dialog re-reads from cache and renders instantly.
   * Saving credentials overwrites the relevant slug so writes do not leave
   * stale data behind.
   */
  const [credentialsCache, setCredentialsCache] = useState<
    Record<
      string,
      {
        fields: HermesProviderCredentialField[];
        authHint: string;
        authType?: string;
        connection?: HermesProviderConnection;
        endpoint?: HermesProviderEndpointResolution;
      }
    >
  >({});
  /** Edit drafts for the *current* hProvider only — reset on switch. */
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  /** True only when the *current* hProvider is not yet in the cache. */
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);

  const currentCredentials = hProvider
    ? credentialsCache[hProvider]
    : undefined;
  const credentialFields = currentCredentials?.fields ?? [];
  const credentialAuthHint = currentCredentials?.authHint ?? "";
  const credentialAuthType = currentCredentials?.authType;
  const providerConnection =
    currentCredentials?.connection ??
    catalog?.providers?.[hProvider]?.connection;
  const providerEndpoint = currentCredentials?.endpoint;

  // ── Model-Config panel state ──────────────────────────────────────────
  const [mcSaving, setMcSaving] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);
  const [mcSaved, setMcSaved] = useState(false);
  // Editable fields used only when configuring a `custom` main model.
  const [customDraftModel, setCustomDraftModel] = useState("");
  const [customDraftBaseUrl, setCustomDraftBaseUrl] = useState("");
  const [displayPreferences, setDisplayPreferences] =
    useState<HermesModelDisplayPreferences>(
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );
  const [displayPending, setDisplayPending] = useState<string | null>(null);
  const [displayError, setDisplayError] = useState<string | null>(null);
  const [moaConfig, setMoaConfig] = useState<HermesMoaConfigResponse | null>(
    null,
  );
  const [selectedModelSummaries, setSelectedModelSummaries] = useState<
    HermesSelectedModelSummary[]
  >([]);
  const showInitialLoading = useDelayedLoading(configurationLoading);
  const catalogStatus: ModelPickerStatus = catalog
    ? "ready"
    : catalogLoading
      ? "loading"
      : "error";

  useEffect(() => {
    if (view === "connection") {
      setProfileId("default");
      return;
    }
    if (profileSelectionIsControlled && profileId) {
      if (!showProfileScope) setProfiles([]);
      return;
    }
    let cancelled = false;
    void getHermesProfiles().then((result) => {
      if (cancelled) return;
      if (!result.ok || result.profiles.length === 0) {
        setProfiles([]);
        setProfileId("default");
        return;
      }
      setProfiles(result.profiles);
      const selectedExists = result.profiles.some(
        (profile) => profile.name === profileId,
      );
      if (!selectedExists) {
        setProfileId(result.active || result.profiles[0]?.name || "default");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    profileId,
    profileSelectionIsControlled,
    setProfileId,
    showProfileScope,
    view,
  ]);

  useEffect(() => {
    setHProvider("");
    setCredentialsCache({});
    setProviderCliModels([]);
    setProviderCliMeta(null);
    setCatalog(null);
    setCatalogLoading(true);
    setCatalogError(null);
    setDisplayPreferences(DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES);
  }, [profileId]);

  // ── Derived ───────────────────────────────────────────────────────────
  const canonicalLabelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of catalog?.canonical_providers ?? []) {
      if (p.slug) m.set(p.slug, (p.tui_desc || p.label || p.slug).trim());
    }
    return m;
  }, [catalog?.canonical_providers]);

  const displayProviders = useMemo(
    () =>
      buildHermesModelProviderViews(
        catalog,
        { ...mainInfo, provider: diskProvider, model: diskModel },
        displayPreferences,
      ),
    [catalog, diskModel, diskProvider, displayPreferences, mainInfo],
  );
  const displayProviderById = useMemo(
    () => new Map(displayProviders.map((provider) => [provider.id, provider])),
    [displayProviders],
  );
  const serviceProviders = useMemo(
    () => displayProviders.filter((provider) => provider.kind !== "virtual"),
    [displayProviders],
  );
  const virtualCapabilities = useMemo(
    () =>
      moaConfig
        ? buildHermesVirtualCapabilityViews(displayProviders, moaConfig)
        : [],
    [displayProviders, moaConfig],
  );

  function providerOptionLabel(id: string): string {
    if (id === "custom") return t("options.models.provider.customName");
    const tui = displayProviderById.get(id)?.label;
    if (tui) return tui;
    return id;
  }

  /**
   * Providers the user explicitly configured *in this extension* (or
   * directly in ``~/.hermes/config.yaml``), plus whichever provider
   * is currently selected as the main / aux model. Deliberately
   * excludes ambient-authenticated rows (Copilot's built-in OAuth,
   * Anthropic's ``~/.claude`` OAuth, AWS SDK creds, …) — those work
   * for Hermes the runtime but aren't "configured here", so listing
   * them surprises users who never touched the panel.
   */
  const allCatalogModels = useMemo(() => {
    const result = new Map<
      string,
      { provider: string; entry: HermesCatalogModelEntry }
    >();
    for (const summary of selectedModelSummaries) {
      result.set(
        hermesSelectedModelSummaryKey(summary.provider, summary.model),
        {
          provider: summary.provider,
          entry: summary.entry,
        },
      );
    }
    const candidates = new Set<string>();
    for (const provider of serviceProviders) {
      if (provider.explicitlyConfigured) candidates.add(provider.id);
    }
    if (diskProvider && diskProvider !== "auto" && diskProvider !== "custom") {
      candidates.add(diskProvider);
    }
    if (auxSlots) {
      for (const slot of AUXILIARY_SLOT_NAMES) {
        const p = auxSlots[slot]?.provider?.trim();
        if (p && p !== "auto" && p !== "custom") candidates.add(p);
      }
    }
    for (const pid of candidates) {
      const block = catalog?.providers?.[pid];
      if (!block?.models?.length) continue;
      for (const m of block.models) {
        if (typeof m.id === "string" && m.id.trim()) {
          result.set(hermesSelectedModelSummaryKey(pid, m.id), {
            provider: pid,
            entry: m,
          });
        }
      }
    }
    return [...result.values()];
  }, [
    auxSlots,
    catalog,
    diskProvider,
    selectedModelSummaries,
    serviceProviders,
  ]);

  // Model assignment dialogs consume the same visibility projection as the
  // composer picker. Credentials make a provider selectable; only its display
  // switch makes it visible here.
  const assignmentProviderGroups = useMemo<ModelPickerGroup[]>(
    () =>
      buildHermesModelPickerGroups(displayProviders).map((group) => ({
        id: `provider:${group.provider}`,
        kind: "provider",
        label: group.label,
        models: group.models.map((entry) => ({
          description: entry.description ?? entry.supplemental?.description,
          metadata: entry.metadata,
          model: entry.id,
          supplemental: entry.supplemental,
        })),
        provider: group.provider,
      })),
    [displayProviders],
  );
  const mainAssignmentPickerGroups = useMemo<ModelPickerGroup[]>(
    () => [
      ...assignmentProviderGroups,
      ...buildHermesVirtualCapabilityPickerGroups(virtualCapabilities).map(
        (group) => ({
          id: `virtual:${group.capability}`,
          kind: "virtual" as const,
          label:
            group.capability === "moa"
              ? t("options.models.virtual.moaTitle")
              : group.label,
          models: group.models.map((entry) => ({
            label: entry.id,
            model: entry.id,
          })),
          provider: group.provider,
        }),
      ),
    ],
    [assignmentProviderGroups, t, virtualCapabilities],
  );

  const modelEntriesForProvider = useMemo((): HermesCatalogModelEntry[] => {
    const p = hProvider.trim();
    if (providerCliModels.length > 0) return providerCliModels;
    const block = catalog?.providers?.[p];
    if (!block?.models?.length) return [];
    return block.models.filter((m) => typeof m.id === "string" && m.id.trim());
  }, [providerCliModels, catalog?.providers, hProvider]);

  const showHermesModelLoading =
    !configurationLoading && hProvider.trim() !== "" && providerCliLoading;

  // ── Load provider models when provider panel changes ──────────────────
  const loadProviderModels = useCallback(
    async (refresh: boolean) => {
      const p = hProvider.trim();
      if (!p) {
        setProviderCliModels([]);
        setProviderCliMeta(null);
        setProviderCliLoading(false);
        return;
      }
      setProviderCliLoading(true);
      try {
        const r = await hermesModelGateway.provider.readModels(
          p,
          refresh,
          profileId,
        );
        if (r.ok && r.models && r.models.length > 0) {
          setProviderCliModels(
            r.models.filter((m) => typeof m.id === "string" && m.id.trim()),
          );
          setProviderCliMeta({
            source: r.source,
            cli_loaded: r.cli_loaded,
            pricing_loaded: r.pricing_loaded,
          });
        } else {
          setProviderCliModels([]);
          setProviderCliMeta({
            source: r.source,
            cli_loaded: r.cli_loaded,
            pricing_loaded: r.pricing_loaded,
          });
        }
      } catch {
        setProviderCliModels([]);
        setProviderCliMeta({
          source: "error",
          cli_loaded: false,
          pricing_loaded: false,
        });
      } finally {
        setProviderCliLoading(false);
      }
    },
    [hProvider, profileId],
  );

  useEffect(() => {
    if (configurationLoading) return;
    const p = hProvider.trim();
    if (!p) {
      setProviderCliModels([]);
      setProviderCliMeta(null);
      setProviderCliLoading(false);
      return;
    }
    setProviderCliModels([]);
    setProviderCliMeta(null);
    void loadProviderModels(false);
  }, [configurationLoading, hProvider, loadProviderModels]);

  // ── Resolve credentials for the active provider ───────────────────────
  // Cache-first: if we've fetched this slug before in the current session,
  // restore drafts from cache and render instantly with no loading state.
  // Only fetch when it's genuinely the first look at this provider.
  useEffect(() => {
    const p = hProvider.trim();
    setKeysError(null);
    if (!p) {
      setKeyDrafts({});
      setKeysLoading(false);
      return;
    }
    const cached = credentialsCache[p];
    if (cached) {
      const drafts: Record<string, string> = {};
      for (const f of cached.fields) drafts[f.key] = f.value;
      setKeyDrafts(drafts);
      setKeysLoading(false);
      return;
    }
    let cancelled = false;
    setKeyDrafts({});
    setKeysLoading(true);
    void hermesModelGateway.provider
      .readCredentials(p, true, profileId)
      .then((r) => {
        if (cancelled) return;
        setKeysLoading(false);
        if (!r.ok) {
          setKeysError(
            r.error || t("options.models.provider.readCredentialsFailed"),
          );
          return;
        }
        setCredentialsCache((prev) => ({
          ...prev,
          [p]: {
            fields: r.fields,
            authHint: r.auth_hint,
            authType: r.auth_type,
            connection: r.connection,
            endpoint: r.endpoint,
          },
        }));
        const drafts: Record<string, string> = {};
        for (const f of r.fields) drafts[f.key] = f.value;
        setKeyDrafts(drafts);
      });
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on credentialsCache — a fetched
    // entry would otherwise re-trigger this effect and clobber the
    // user's drafts. Cache reads happen the next time hProvider flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hProvider, profileId]);

  // ── Fast local configuration load ─────────────────────────────────────
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setConfigurationLoading(true);
    setMainError(null);
    void hermesModelGateway.workspace
      .readConfiguration(profileId)
      .then(
        ({
          main,
          auxiliary,
          moa,
          displayPreferences,
          selectedModelSummaries: rememberedModels,
        }) => {
          if (cancelled) return;
          setConfigurationLoading(false);
          setDisplayPreferences(displayPreferences);
          setSelectedModelSummaries(rememberedModels);
          setMainInfo(main);
          setMoaConfig(moa);
          if (!main.ok) {
            setMainError(
              main.error || t("options.models.config.readMainFailed"),
            );
          } else {
            const dp = (main.provider || "auto").trim() || "auto";
            const dm = (main.model || "").trim();
            const bu = (main.base_url || "").trim();
            setDiskProvider(dp);
            setDiskModel(dm);
            setCustomDraftModel(dp === "custom" ? dm : "");
            setCustomDraftBaseUrl(dp === "custom" ? bu : "");
          }

          if (auxiliary.ok) setAuxSlots(tasksToMap(auxiliary));
          else setAuxError(auxiliary.error || null);
        },
      )
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setConfigurationLoading(false);
        setMainError(String((loadError as Error)?.message || loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, t]);

  // ── Shared stale-while-revalidate catalog load ─────────────────────────
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const cached = hermesModelGateway.catalog.peek(profileId);
    if (cached) {
      setCatalog(cached);
      setCatalogLoading(false);
    } else {
      setCatalogLoading(true);
    }
    const unwatch = hermesModelGateway.catalog.watch((nextCatalog) => {
      if (cancelled) return;
      setCatalog(nextCatalog);
      setCatalogLoading(false);
      setCatalogError(null);
    }, profileId);
    void hermesModelGateway.catalog
      .read(false, profileId)
      .then((nextCatalog) => {
        if (cancelled) return;
        setCatalogLoading(false);
        if (nextCatalog.ok) {
          setCatalog(nextCatalog);
          setCatalogError(null);
        } else if (!cached) {
          setCatalogError(
            nextCatalog.error || t("sidepanel.modelPicker.loadFailed"),
          );
        }
      });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [profileId, t]);

  useEffect(
    () =>
      hermesModelGateway.display.watch((preferences) => {
        setDisplayPreferences(preferences);
      }, profileId),
    [profileId],
  );

  useEffect(
    () =>
      hermesModelGateway.summaries.watch((summaries) => {
        setSelectedModelSummaries(summaries);
      }),
    [],
  );

  /**
   * Save credentials for the current provider. This writes ONLY to the
   * plugin ``.env``. It never touches ``config.yaml: model.*`` — setting
   * the main model is exclusively the Model Config panel's job (the ⭐
   * action, or the custom-main editor).
   */
  async function saveProviderCredentials(activeCredentialKey?: string) {
    const p = hProvider.trim();
    if (!p || credentialFields.length === 0) return;
    setHSaving(true);
    setHError(null);
    setKeysError(null);
    try {
      const values: Record<string, string> = {};
      const alternativeCredentialKeys = credentialFields
        .filter((field) => field.kind === "secret")
        .map((field) => field.key);
      for (const field of credentialFields) {
        const draft = keyDrafts[field.key] ?? "";
        if (field.kind !== "secret") {
          values[field.key] = draft;
          continue;
        }
        if (
          activeCredentialKey &&
          alternativeCredentialKeys.length > 1 &&
          field.key !== activeCredentialKey
        ) {
          // Selecting a method is explicit: remove saved alternatives.
          values[field.key] = "";
          continue;
        }
        values[field.key] = draft;
      }
      const r = await hermesModelGateway.provider.writeCredentials(
        p,
        values,
        profileId,
      );
      if (!r.ok) {
        setHError(r.error || t("options.models.provider.saveFailed"));
        return;
      }
      const nextFields = r.fields?.length
        ? r.fields
        : credentialFields.map((field) => ({
            ...field,
            value: values[field.key] ?? "",
          }));
      const nextDrafts: Record<string, string> = {};
      for (const field of nextFields) nextDrafts[field.key] = field.value;
      setKeyDrafts(nextDrafts);
      // The backend returns the normalized effective connection after the
      // write, including Copilot verification. Cache that domain result
      // instead of reconstructing provider-specific priority in React.
      setCredentialsCache((prev) => {
        const cached = prev[p];
        if (!cached) return prev;
        return {
          ...prev,
          [p]: {
            ...cached,
            fields: nextFields,
            authHint: r.auth_hint || cached.authHint,
            authType: r.auth_type || cached.authType,
            connection: r.connection,
            endpoint: r.endpoint ?? cached.endpoint,
          },
        };
      });
      const refreshedCatalog = await hermesModelGateway.catalog.read(
        true,
        profileId,
      );
      if (refreshedCatalog.ok) setCatalog(refreshedCatalog);
      void loadProviderModels(true);
      setHSaved(true);
      setTimeout(() => setHSaved(false), 1500);
    } finally {
      setHSaving(false);
    }
  }

  function openProviderConfiguration(slug: string) {
    setHProvider(slug);
  }

  async function setDisplayedProvider(provider: string, visible: boolean) {
    const pendingKey = `provider:${provider}`;
    setDisplayPending(pendingKey);
    setDisplayError(null);
    try {
      const next = await hermesModelGateway.display.setProviderVisibility(
        provider,
        visible,
        profileId,
      );
      setDisplayPreferences(next);
    } catch {
      setDisplayError(t("options.models.display.saveFailed"));
    } finally {
      setDisplayPending((current) => (current === pendingKey ? null : current));
    }
  }

  async function setDisplayedModel(
    provider: string,
    model: string,
    visible: boolean,
  ) {
    const pendingKey = `model:${provider}:${model}`;
    setDisplayPending(pendingKey);
    setDisplayError(null);
    try {
      const next = await hermesModelGateway.display.setModelVisibility(
        provider,
        model,
        visible,
        profileId,
      );
      setDisplayPreferences(next);
    } catch {
      setDisplayError(t("options.models.display.saveFailed"));
    } finally {
      setDisplayPending((current) => (current === pendingKey ? null : current));
    }
  }

  // ── Model Config: assign a catalog model to the Main slot ──────────────
  async function setDefaultModel(provider: string, modelId: string) {
    const p = provider.trim();
    const id = modelId.trim();
    if (!id) return;
    setMcSaving(true);
    setMcError(null);
    try {
      // Clearing base_url on every canonical-provider switch keeps a
      // stale ``model.base_url`` from leaking into the new provider.
      // The custom-main editor below has its own write path that
      // explicitly sets base_url; that's the only place it gets set.
      const r = await hermesModelGateway.main.write(
        {
          provider: p || "auto",
          model: id,
          base_url: null,
        },
        profileId,
      );
      if (!r.ok) {
        setMcError(r.error || t("options.models.config.setMainFailed"));
        return;
      }
      const dp = (r.provider || p || "auto").trim() || "auto";
      const dm = (r.model ?? id).trim();
      setMainInfo(r);
      setDiskProvider(dp);
      setDiskModel(dm);
      setMcSaved(true);
      setTimeout(() => setMcSaved(false), 1500);
    } finally {
      setMcSaving(false);
    }
  }

  /** Set the main model to a `custom` endpoint with an explicit base URL. */
  async function setCustomMainModel() {
    const id = customDraftModel.trim();
    const bu = customDraftBaseUrl.trim();
    if (!id || !bu) return;
    setMcSaving(true);
    setMcError(null);
    try {
      const r = await hermesModelGateway.main.write(
        {
          provider: "custom",
          model: id,
          base_url: bu,
        },
        profileId,
      );
      if (!r.ok) {
        setMcError(r.error || t("options.models.config.setCustomFailed"));
        return;
      }
      setDiskProvider("custom");
      setDiskModel(id);
      setMainInfo(r);
      setMcSaved(true);
      setTimeout(() => setMcSaved(false), 1500);
    } finally {
      setMcSaving(false);
    }
  }

  // ── Model Config: set / clear auxiliary slot ──────────────────────────
  // Upstream `/api/model/set` uses `task` (not `slot`) as the slot id.
  async function setAuxSlot(
    task: AuxiliarySlotName,
    provider: string,
    model: string,
  ) {
    setAuxSavingSlot(task);
    setAuxError(null);
    try {
      const r = await hermesModelGateway.auxiliary.write(
        {
          task,
          provider: provider.trim(),
          model: model.trim(),
        },
        profileId,
      );
      if (!r.ok) {
        setAuxError(r.error || t("options.models.config.saveFailed"));
        return;
      }
      const next = tasksToMap(r);
      if (next) setAuxSlots(next);
      setAuxSavedSlot(task);
      setTimeout(() => setAuxSavedSlot(null), 1500);
    } finally {
      setAuxSavingSlot(null);
    }
  }

  async function clearAuxSlot(task: AuxiliarySlotName) {
    setAuxSavingSlot(task);
    setAuxError(null);
    try {
      const r = await hermesModelGateway.auxiliary.write(
        {
          task,
          provider: "",
          model: "",
        },
        profileId,
      );
      if (!r.ok) {
        setAuxError(r.error || t("options.models.config.clearFailed"));
        return;
      }
      const next = tasksToMap(r);
      if (next) setAuxSlots(next);
    } finally {
      setAuxSavingSlot(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {view === "connection" ? (
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <PageContent size="md">
            <SettingsGateway bridge={bridge} />
          </PageContent>
        </ScrollArea>
      ) : view === "multi-model-collaboration" ? (
        configurationLoading ? (
          <ModelSettingsLoadingSkeleton
            visible={showInitialLoading}
            view="multi-model-collaboration"
          />
        ) : (
          <VirtualCapabilitiesPanel
            config={moaConfig}
            capability={virtualCapabilities[0]}
            modelSummaries={selectedModelSummaries}
            profileId={profileId}
            providerCatalogStatus={catalogStatus}
            providers={serviceProviders}
            scopeControl={
              showProfileScope ? (
                <ProfileScopeControl
                  onChange={setProfileId}
                  profiles={profiles}
                  value={profileId}
                />
              ) : undefined
            }
            onSaved={setMoaConfig}
          />
        )
      ) : configurationLoading ? (
        <ModelSettingsLoadingSkeleton
          visible={showInitialLoading}
          view="models"
        />
      ) : (
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <PageContent bodyClassName="space-y-8" size="md">
            {showProfileScope ? (
              <div className="flex justify-end">
                <ProfileScopeControl
                  onChange={setProfileId}
                  profiles={profiles}
                  value={profileId}
                />
              </div>
            ) : null}
            <ModelConfigPanel
              diskProvider={diskProvider}
              diskModel={diskModel}
              auxSlots={auxSlots}
              auxError={auxError}
              auxSavingSlot={auxSavingSlot}
              auxSavedSlot={auxSavedSlot}
              mcSaving={mcSaving}
              mcError={mcError || mainError}
              mcSaved={mcSaved}
              allCatalogModels={allCatalogModels}
              mainPickerGroups={mainAssignmentPickerGroups}
              auxiliaryPickerGroups={assignmentProviderGroups}
              catalogStatus={catalogStatus}
              catalogError={catalogError}
              onSetDefault={setDefaultModel}
              onSetAuxSlot={setAuxSlot}
              onClearAuxSlot={clearAuxSlot}
            />
            <ModelDisplayPanel
              providers={serviceProviders}
              connections={Object.fromEntries(
                serviceProviders.map((provider) => [
                  provider.id,
                  credentialsCache[provider.id]?.connection ??
                    provider.connection,
                ]),
              )}
              error={displayError}
              loadError={catalogError}
              loading={catalogLoading && !catalog}
              pending={displayPending}
              onConfigureProvider={openProviderConfiguration}
              onProviderVisibilityChange={setDisplayedProvider}
              onModelVisibilityChange={setDisplayedModel}
            />
            {catalog &&
            !serviceProviders.some((provider) => provider.id === "custom") ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openProviderConfiguration("custom")}
              >
                {t("options.models.provider.addCustom")}
              </Button>
            ) : null}
          </PageContent>
        </ScrollArea>
      )}

      <Dialog
        open={Boolean(hProvider)}
        onOpenChange={(open) => {
          if (!open && !hSaving && !mcSaving) setHProvider("");
        }}
      >
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
                  provider={hProvider}
                />
                <span className="truncate">
                  {providerOptionLabel(hProvider)}
                </span>
              </DialogTitle>
              <ProviderConnectionStatusBadge
                connection={providerConnection}
                fields={credentialFields}
                provider={hProvider}
              />
            </div>
          </DialogHeader>
          <ScrollArea
            className="h-0 min-h-0 flex-1"
            data-provider-config-scroll
          >
            <ProviderPanel
              hProvider={hProvider}
              hSaving={hSaving}
              hSaved={hSaved}
              hError={hError}
              credentialFields={credentialFields}
              credentialAuthHint={credentialAuthHint}
              credentialAuthType={credentialAuthType}
              providerEndpoint={providerEndpoint}
              providerConnection={providerConnection}
              keyDrafts={keyDrafts}
              keysLoading={keysLoading}
              keysError={keysError}
              catalog={catalog}
              showHermesModelLoading={showHermesModelLoading}
              modelEntriesForProvider={modelEntriesForProvider}
              providerCliMeta={providerCliMeta}
              onKeyDraftChange={(key, value) =>
                setKeyDrafts((current) => ({ ...current, [key]: value }))
              }
              onSave={(activeCredentialKey) =>
                void saveProviderCredentials(activeCredentialKey)
              }
              onRefreshModels={() => void loadProviderModels(true)}
              customDraftModel={customDraftModel}
              customDraftBaseUrl={customDraftBaseUrl}
              customSaving={mcSaving}
              customError={mcError}
              onCustomDraftModelChange={setCustomDraftModel}
              onCustomDraftBaseUrlChange={setCustomDraftBaseUrl}
              onSetCustomMain={setCustomMainModel}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Config Panel
// ─────────────────────────────────────────────────────────────────────────────

interface ModelConfigPanelProps {
  diskProvider: string;
  diskModel: string;
  auxSlots: Record<AuxiliarySlotName, AuxiliaryTask> | null;
  auxError: string | null;
  auxSavingSlot: AuxiliarySlotName | null;
  auxSavedSlot: AuxiliarySlotName | null;
  mcSaving: boolean;
  mcError: string | null;
  mcSaved: boolean;
  allCatalogModels: { provider: string; entry: HermesCatalogModelEntry }[];
  mainPickerGroups: ModelPickerGroup[];
  auxiliaryPickerGroups: ModelPickerGroup[];
  catalogStatus: ModelPickerStatus;
  catalogError: string | null;
  onSetDefault: (provider: string, modelId: string) => Promise<void>;
  onSetAuxSlot: (
    slot: AuxiliarySlotName,
    provider: string,
    model: string,
  ) => Promise<void>;
  onClearAuxSlot: (slot: AuxiliarySlotName) => Promise<void>;
}

function ModelConfigPanel({
  diskProvider,
  diskModel,
  auxSlots,
  auxError,
  auxSavingSlot,
  auxSavedSlot,
  mcSaving,
  mcError,
  mcSaved,
  allCatalogModels,
  mainPickerGroups,
  auxiliaryPickerGroups,
  catalogStatus,
  catalogError,
  onSetDefault,
  onSetAuxSlot,
  onClearAuxSlot,
}: ModelConfigPanelProps) {
  const { t } = useT();
  const [auxExpanded, setAuxExpanded] = useState(false);

  const saving = mcSaving || auxSavingSlot !== null;
  const configuredAuxCount = auxSlots
    ? AUXILIARY_SLOT_NAMES.filter((s) => auxSlots[s]?.model).length
    : 0;

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("options.models.config.defaultsTitle")}
      />
      {(mcError || auxError) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {mcError || auxError}
        </p>
      )}

      <div className={MODEL_SETTINGS_SURFACE_CLASS} data-model-settings-surface>
        <ModelSlotRow
          label={t("options.models.config.main")}
          appearance="primary"
          provider={diskProvider}
          model={diskModel}
          unsetHint={t("options.models.config.mainUnset")}
          isSaving={mcSaving}
          isSaved={mcSaved}
          allCatalogModels={allCatalogModels}
          pickerGroups={mainPickerGroups}
          pickerStatus={catalogStatus}
          pickerError={catalogError}
          disabled={saving}
          onSet={(p, m) => void onSetDefault(p, m)}
        />

        <button
          type="button"
          aria-expanded={auxExpanded}
          className="flex w-full items-center gap-3 border-t border-border/60 bg-muted/[0.035] px-4 py-3 text-left transition-colors hover:bg-muted/20"
          onClick={() => setAuxExpanded((v) => !v)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-foreground">
              {t("options.models.config.auxiliaryModels")}
            </span>
          </span>
          <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            {configuredAuxCount}/{AUXILIARY_SLOT_NAMES.length}
          </span>
          {auxExpanded ? (
            <ChevronDown
              aria-hidden
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          ) : (
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 text-muted-foreground"
            />
          )}
        </button>

        {auxExpanded && (
          <div className="border-t border-border/60">
            {auxSlots === null ? (
              <p className="px-4 py-5 text-xs text-muted-foreground">
                {t("options.models.config.auxiliaryUnavailable")}
              </p>
            ) : (
              <div className="grid gap-px bg-border/50 sm:grid-cols-2">
                {AUXILIARY_SLOT_NAMES.map((slot) => (
                  <ModelSlotRow
                    key={slot}
                    label={t(AUXILIARY_SLOT_MESSAGE_KEYS[slot])}
                    appearance="compact"
                    provider={auxSlots[slot]?.provider ?? ""}
                    model={auxSlots[slot]?.model ?? ""}
                    clearOptionLabel={t("options.models.config.useMainModel")}
                    isSaving={auxSavingSlot === slot}
                    isSaved={auxSavedSlot === slot}
                    allCatalogModels={allCatalogModels}
                    pickerGroups={auxiliaryPickerGroups}
                    pickerStatus={catalogStatus}
                    pickerError={catalogError}
                    disabled={saving}
                    onSet={(p, m) => void onSetAuxSlot(slot, p, m)}
                    onClear={() => void onClearAuxSlot(slot)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Model Slot Row — used for Main and every auxiliary slot
// ─────────────────────────────────────────────────────────────────────────────

interface ModelSlotRowProps {
  label: string;
  appearance?: "primary" | "compact";
  provider: string;
  model: string;
  unsetHint?: string;
  clearOptionLabel?: string;
  isSaving: boolean;
  isSaved: boolean;
  allCatalogModels: { provider: string; entry: HermesCatalogModelEntry }[];
  pickerGroups: ModelPickerGroup[];
  pickerStatus: ModelPickerStatus;
  pickerError: string | null;
  disabled: boolean;
  onSet: (provider: string, model: string) => void;
  onClear?: () => void;
}

function ModelSlotRow({
  label,
  appearance = "compact",
  provider,
  model,
  unsetHint,
  clearOptionLabel,
  isSaving,
  isSaved,
  allCatalogModels,
  pickerGroups,
  pickerStatus,
  pickerError,
  disabled,
  onSet,
  onClear,
}: ModelSlotRowProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);

  const hasModel = Boolean(model);
  const selectedEntry = allCatalogModels.find(
    (candidate) =>
      candidate.provider === provider && candidate.entry.id === model,
  )?.entry;
  const displayName = selectedEntry
    ? resolveCatalogModelDisplayName(selectedEntry)
    : model;

  const handleOpenChange = (next: boolean) => {
    if (next && (disabled || isSaving)) return;
    setOpen(next);
  };

  return (
    <>
      <div
        className={cn(
          "bg-background",
          appearance === "primary" ? "px-4 py-4" : "px-3 py-3",
        )}
      >
        <button
          type="button"
          className={cn(
            "grid w-full items-center text-left transition-opacity",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            appearance === "primary"
              ? "gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)_auto]"
              : "grid-cols-[6.75rem_minmax(0,1fr)_auto] gap-2",
          )}
          disabled={disabled || isSaving}
          onClick={() => handleOpenChange(true)}
        >
          <span className="min-w-0">
            <span
              className={cn(
                "block font-medium text-foreground",
                appearance === "primary" ? "text-xs" : "text-[11px]",
              )}
            >
              {label}
            </span>
          </span>

          <span
            className="flex min-w-0 items-center gap-2.5"
            data-model-slot-identity
          >
            {hasModel ? (
              <ModelIcon
                className={cn(
                  "shrink-0 text-muted-foreground",
                  appearance === "primary" ? "h-5 w-5" : "h-4 w-4",
                )}
                model={model}
                provider={provider}
              />
            ) : (
              <span
                aria-hidden
                className={cn(
                  "shrink-0 rounded-full border border-dashed border-muted-foreground/30",
                  appearance === "primary" ? "h-5 w-5" : "h-4 w-4",
                )}
              />
            )}
            <span className="min-w-0" data-model-slot-label>
              {hasModel ? (
                <ModelIdentityName
                  className="flex"
                  displayName={displayName}
                  model={model}
                  variant={appearance === "primary" ? "standard" : "picker"}
                />
              ) : (
                <span className="block truncate text-[10px] leading-none text-muted-foreground">
                  {unsetHint ?? t("options.models.config.useMainModel")}
                </span>
              )}
            </span>
          </span>

          <span className="flex items-center justify-end gap-1.5">
            {isSaving ? (
              <Loader2
                aria-hidden
                className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              />
            ) : isSaved ? (
              <Check
                aria-label={t("options.models.config.saved")}
                className="h-3.5 w-3.5 text-[hsl(var(--success))]"
              />
            ) : null}
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 text-muted-foreground/60"
            />
          </span>
        </button>
      </div>

      <ModelPickerDialog
        description={t("options.models.config.pickerDescription")}
        errorMessage={pickerError ?? undefined}
        groups={pickerGroups}
        onOpenChange={handleOpenChange}
        onSelect={(pid, selectedModel) => {
          onSet(pid, selectedModel);
          handleOpenChange(false);
        }}
        open={open}
        resetOption={
          onClear
            ? {
                description: t("options.models.config.useMainModelDescription"),
                label:
                  clearOptionLabel ?? t("options.models.config.useMainModel"),
                onSelect: () => {
                  onClear();
                  handleOpenChange(false);
                },
                selected: !hasModel,
              }
            : undefined
        }
        saving={isSaving}
        status={pickerStatus}
        searchPlaceholder={t("options.models.config.searchForTask", {
          task: label,
        })}
        selected={{ model, provider }}
        title={t("options.models.config.pickerTitle", { task: label })}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-component: Provider Panel
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderPanelProps {
  hProvider: string;
  hSaving: boolean;
  hSaved: boolean;
  hError: string | null;
  credentialFields: HermesProviderCredentialField[];
  credentialAuthHint: string;
  credentialAuthType?: string;
  providerEndpoint?: HermesProviderEndpointResolution;
  providerConnection?: HermesProviderConnection;
  keyDrafts: Record<string, string>;
  keysLoading: boolean;
  keysError: string | null;
  catalog: HermesModelCatalogResponse | null;
  showHermesModelLoading: boolean;
  modelEntriesForProvider: HermesCatalogModelEntry[];
  providerCliMeta: {
    source?: string;
    cli_loaded?: boolean;
    pricing_loaded?: boolean;
  } | null;
  onKeyDraftChange: (k: string, v: string) => void;
  onSave: (activeCredentialKey?: string) => void;
  onRefreshModels: () => void;
  // Custom endpoint (BYO OpenAI-compatible) — only used when
  // ``hProvider === "custom"``. The provider dialog owns the complete
  // endpoint flow: URL, model id, credentials, and main-model assignment.
  customDraftModel: string;
  customDraftBaseUrl: string;
  customSaving: boolean;
  customError: string | null;
  onCustomDraftModelChange: (v: string) => void;
  onCustomDraftBaseUrlChange: (v: string) => void;
  onSetCustomMain: () => Promise<void>;
}

function ProviderPanel({
  hProvider,
  hSaving,
  hSaved,
  hError,
  credentialFields,
  credentialAuthHint,
  credentialAuthType,
  providerEndpoint,
  providerConnection,
  keyDrafts,
  keysLoading,
  keysError,
  catalog,
  showHermesModelLoading,
  modelEntriesForProvider,
  providerCliMeta,
  onKeyDraftChange,
  onSave,
  onRefreshModels,
  customDraftModel,
  customDraftBaseUrl,
  customSaving,
  customError,
  onCustomDraftModelChange,
  onCustomDraftBaseUrlChange,
  onSetCustomMain,
}: ProviderPanelProps) {
  const { t } = useT();
  return (
    <div className="space-y-4 p-6">
      {catalog?.warning && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {catalog.warning}
        </p>
      )}
      {catalog?.ok && catalog.canonical_loaded === false && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {t("options.models.provider.metadataPartial")}
        </p>
      )}
      {hError && (
        <p className="text-[11px] text-amber-600 dark:text-amber-500">
          {hError}
        </p>
      )}

      {/* Credentials write only to Hermes' .env. Main-model assignment lives
          in the model configuration surface. */}
      <section className="space-y-5">
        <div className="space-y-5">
          {hProvider === "custom" && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/10 px-4 py-3">
              <p className="text-[11px] text-muted-foreground">
                {t("options.models.provider.customDescription")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="custom-main-model" className="text-xs">
                  {t("options.models.provider.customModel")}
                </Label>
                <Input
                  id="custom-main-model"
                  value={customDraftModel}
                  onChange={(e) => onCustomDraftModelChange(e.target.value)}
                  placeholder={t(
                    "options.models.provider.customModelPlaceholder",
                  )}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="custom-main-url" className="text-xs">
                  {t("options.models.provider.customEndpoint")}
                </Label>
                <Input
                  id="custom-main-url"
                  value={customDraftBaseUrl}
                  onChange={(e) => onCustomDraftBaseUrlChange(e.target.value)}
                  placeholder="https://your-endpoint/v1"
                  className="font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {customError && (
                <p className="text-[11px] text-amber-600 dark:text-amber-500">
                  {customError}
                </p>
              )}
              <div className="pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    customSaving ||
                    !customDraftModel.trim() ||
                    !customDraftBaseUrl.trim()
                  }
                  onClick={() => void onSetCustomMain()}
                >
                  {customSaving
                    ? t("common.saving")
                    : t("options.models.provider.setDefault")}
                </Button>
              </div>
            </div>
          )}

          <ProviderCredentialEditor
            authHint={credentialAuthHint}
            authType={
              credentialAuthType ?? catalog?.providers?.[hProvider]?.auth_type
            }
            connection={providerConnection}
            endpoint={providerEndpoint}
            error={keysError}
            fields={credentialFields}
            loading={keysLoading}
            onChange={onKeyDraftChange}
            onSave={onSave}
            provider={hProvider}
            saved={hSaved}
            saving={hSaving}
            values={keyDrafts}
          />
        </div>
      </section>

      {/* Model list (display only) */}
      {hProvider && (
        <section className="space-y-3 border-t border-border pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-foreground">
              {t("options.models.provider.models")}
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              disabled={showHermesModelLoading}
              onClick={onRefreshModels}
              title={t("options.models.provider.refreshModels")}
            >
              {showHermesModelLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {t("common.refresh")}
            </Button>
          </div>
          <div className="space-y-3">
            {showHermesModelLoading ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                {t("options.models.provider.loadingModels")}
              </p>
            ) : modelEntriesForProvider.length > 0 ? (
              <>
                <div className="rounded-lg border border-border bg-background">
                  <ul className="divide-y divide-border/50">
                    {modelEntriesForProvider.map((entry) => (
                      <li
                        key={entry.id}
                        className="transition-colors hover:bg-muted/[0.12]"
                      >
                        <ModelCatalogEntryCard
                          className="rounded-none border-0 bg-transparent px-3 py-2.5"
                          entry={entry}
                          provider={hProvider}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
                {!showHermesModelLoading &&
                providerCliMeta?.source === "manifest" ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t("options.models.provider.referenceList")}
                  </p>
                ) : null}
                {!showHermesModelLoading && providerCliMeta?.pricing_loaded ? (
                  <p className="text-[10px] text-muted-foreground">
                    {t("options.models.provider.pricingHint")}
                  </p>
                ) : null}
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-border/80 bg-muted/15 p-4">
                <p className="text-xs text-muted-foreground">
                  {t("options.models.provider.noModels")}
                </p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
