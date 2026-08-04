/**
 * Public boundary between Amiba surfaces and Hermes Agent's model APIs.
 *
 * Hermes owns runtime configuration, credentials, provider discovery, and
 * model catalogs. Amiba owns one additional concern: which of those discovered
 * providers and models should be advertised in Amiba's compact pickers.
 *
 * UI code must consume this gateway instead of interpreting Hermes wire fields
 * such as `authenticated`, `source`, and `config_provider_ids` independently.
 */

import { getPlatform } from "@amiba/platform";

import {
  getHermesAuxiliaryModels,
  getHermesMainModelInfo,
  getHermesMoaConfig,
  getHermesModelCatalog,
  getHermesProviderCredentials,
  getHermesProviderModels,
  saveHermesProviderCredentials,
  saveHermesMoaConfig,
  setHermesAgentMainModel,
  setHermesAuxiliarySlot,
  type AuxiliaryModelsResponse,
  type AuxiliarySlotName,
  type HermesAgentMainModelResponse,
  type HermesCatalogModelEntry,
  type HermesCatalogProviderBlock,
  type HermesModelCatalogResponse,
  type HermesMoaConfigResponse,
  type HermesMoaModelSlot,
  type HermesMoaPreset,
  type HermesProviderCredentialsResponse,
  type HermesProviderModelsResponse,
} from "./hermes-agent-model";

export const HERMES_MODEL_DISPLAY_PREFS_STORAGE_KEY = "settings.models.display";
export const HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY =
  "settings.models.selected-summaries";

export interface HermesModelDisplayPreferences {
  version: 1;
  /**
   * Explicit user choices. Missing means hidden unless this is the current
   * provider. Credential/configuration state describes whether a provider can
   * connect; it never implicitly opts that provider into Amiba's pickers.
   */
  providerOverrides: Record<string, boolean>;
  /** Model ids hidden inside an otherwise-visible provider. */
  hiddenModels: Record<string, string[]>;
}

/**
 * Last-known descriptive data for a model that has appeared in a saved
 * assignment. This is presentation-only: authentication and availability are
 * deliberately excluded because those signals must always be checked live.
 */
export interface HermesSelectedModelSummary {
  provider: string;
  model: string;
  entry: HermesCatalogModelEntry;
  updatedAt: number;
}

export const DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES: HermesModelDisplayPreferences =
  {
    version: 1,
    providerOverrides: {},
    hiddenModels: {},
  };

export type HermesProviderConnectionSource =
  | "config"
  | "saved-credentials"
  | "detected-credentials"
  | "available";

/**
 * Amiba's provider taxonomy. It is intentionally richer than Hermes's picker
 * list: only `virtual` rows are capabilities rather than service providers.
 */
export type HermesProviderKind = "remote" | "local" | "process" | "virtual";

export interface HermesModelDisplayEntry extends HermesCatalogModelEntry {
  current: boolean;
  visible: boolean;
}

export interface HermesModelProviderView {
  id: string;
  label: string;
  kind: HermesProviderKind;
  source: HermesProviderConnectionSource;
  catalogSource?: string;
  authType?: string;
  warning?: string;
  connection?: HermesProviderCredentialsResponse["connection"];
  authenticated: boolean;
  explicitlyConfigured: boolean;
  current: boolean;
  /**
   * A provider is selectable when Hermes has a credential/config signal and
   * at least one model. Merely shipping a canonical provider row is not enough.
   */
  selectable: boolean;
  /**
   * Effective Amiba visibility after applying the user's local override. The
   * current provider is always visible so an active route never disappears.
   */
  visible: boolean;
  models: HermesModelDisplayEntry[];
}

export interface HermesModelPickerGroup {
  label: string;
  models: HermesCatalogModelEntry[];
  provider: string;
}

export interface HermesVirtualCapabilityPickerGroup
  extends HermesModelPickerGroup {
  capability: string;
}

export type HermesVirtualDependencyRole = "reference" | "aggregator";
export type HermesVirtualDependencyStatus =
  | "ready"
  | "provider-unavailable"
  | "provider-hidden"
  | "model-unavailable"
  | "model-hidden";
export type HermesVirtualCapabilityStatus =
  | "ready"
  | "degraded"
  | "unavailable"
  | "disabled";

export interface HermesVirtualCapabilityDependency extends HermesMoaModelSlot {
  role: HermesVirtualDependencyRole;
  index: number;
  providerLabel: string;
  status: HermesVirtualDependencyStatus;
}

export interface HermesVirtualCapabilityPreset {
  id: string;
  enabled: boolean;
  current: boolean;
  status: HermesVirtualCapabilityStatus;
  config: HermesMoaPreset;
  dependencies: HermesVirtualCapabilityDependency[];
}

export interface HermesVirtualCapabilityView {
  id: string;
  provider: string;
  label: string;
  current: boolean;
  configured: boolean;
  defaultPreset: string;
  activePreset: string;
  presets: HermesVirtualCapabilityPreset[];
}

export interface HermesModelPickerSnapshot {
  ok: boolean;
  error?: string;
  current: {
    provider: string;
    model: string;
  };
  groups: HermesModelPickerGroup[];
  capabilities: HermesVirtualCapabilityPickerGroup[];
}

export interface HermesModelWorkspaceSnapshot {
  main: HermesAgentMainModelResponse;
  catalog: HermesModelCatalogResponse;
  auxiliary: AuxiliaryModelsResponse;
  moa: HermesMoaConfigResponse;
  displayPreferences: HermesModelDisplayPreferences;
  selectedModelSummaries: HermesSelectedModelSummary[];
  /** Actual service providers only; virtual providers have their own surface. */
  providers: HermesModelProviderView[];
  virtualProviders: HermesModelProviderView[];
  virtualCapabilities: HermesVirtualCapabilityView[];
}

export interface HermesModelConfigurationSnapshot {
  main: HermesAgentMainModelResponse;
  auxiliary: AuxiliaryModelsResponse;
  moa: HermesMoaConfigResponse;
  displayPreferences: HermesModelDisplayPreferences;
  selectedModelSummaries: HermesSelectedModelSummary[];
}

export interface HermesCurrentModelIdentitySnapshot {
  ok: boolean;
  error?: string;
  current: {
    provider: string;
    model: string;
  };
  summary?: HermesSelectedModelSummary;
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = cleanId(raw);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function normalizeHermesModelDisplayPreferences(
  value: unknown,
): HermesModelDisplayPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: 1,
      providerOverrides: {},
      hiddenModels: {},
    };
  }

  const input = value as {
    providerOverrides?: unknown;
    hiddenModels?: unknown;
  };
  const providerOverrides: Record<string, boolean> = {};
  if (
    input.providerOverrides &&
    typeof input.providerOverrides === "object" &&
    !Array.isArray(input.providerOverrides)
  ) {
    for (const [rawSlug, rawVisible] of Object.entries(
      input.providerOverrides as Record<string, unknown>,
    )) {
      const slug = cleanId(rawSlug);
      if (slug && typeof rawVisible === "boolean") {
        providerOverrides[slug] = rawVisible;
      }
    }
  }

  const hiddenModels: Record<string, string[]> = {};
  if (
    input.hiddenModels &&
    typeof input.hiddenModels === "object" &&
    !Array.isArray(input.hiddenModels)
  ) {
    for (const [rawSlug, rawModels] of Object.entries(
      input.hiddenModels as Record<string, unknown>,
    )) {
      const slug = cleanId(rawSlug);
      if (!slug || !Array.isArray(rawModels)) continue;
      const models = uniqueStrings(
        rawModels.map((model) =>
          typeof model === "string" ? model : undefined,
        ),
      );
      if (models.length) hiddenModels[slug] = models;
    }
  }

  return {
    version: 1,
    providerOverrides,
    hiddenModels,
  };
}

const MAX_SELECTED_MODEL_SUMMARIES = 64;

export function hermesSelectedModelSummaryKey(
  provider: string,
  model: string,
): string {
  return `${cleanId(provider)}\u0000${cleanId(model)}`;
}

function normalizeMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeSummaryEntry(
  value: unknown,
  model: string,
): HermesCatalogModelEntry {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const description = cleanId(input.description);
  const metadata = normalizeMetadata(input.metadata);
  const supplementalInput =
    input.supplemental &&
    typeof input.supplemental === "object" &&
    !Array.isArray(input.supplemental)
      ? (input.supplemental as Record<string, unknown>)
      : null;
  const supplementalSource = cleanId(supplementalInput?.source);
  const supplementalDescription = cleanId(supplementalInput?.description);
  const supplementalMetadata = normalizeMetadata(supplementalInput?.metadata);

  return {
    id: model,
    ...(description ? { description } : {}),
    ...(metadata ? { metadata } : {}),
    ...(supplementalSource && supplementalMetadata
      ? {
          supplemental: {
            source: supplementalSource,
            ...(supplementalDescription
              ? { description: supplementalDescription }
              : {}),
            metadata: supplementalMetadata,
          },
        }
      : {}),
  };
}

export function normalizeHermesSelectedModelSummaries(
  value: unknown,
): HermesSelectedModelSummary[] {
  const rawItems =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(rawItems)) return [];

  const summaries = new Map<string, HermesSelectedModelSummary>();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const input = raw as Record<string, unknown>;
    const provider = cleanId(input.provider);
    const model = cleanId(input.model);
    if (!provider || !model) continue;
    const updatedAt =
      typeof input.updatedAt === "number" &&
      Number.isFinite(input.updatedAt) &&
      input.updatedAt > 0
        ? input.updatedAt
        : 0;
    const summary = {
      provider,
      model,
      entry: normalizeSummaryEntry(input.entry, model),
      updatedAt,
    };
    const key = hermesSelectedModelSummaryKey(provider, model);
    const existing = summaries.get(key);
    if (!existing || summary.updatedAt >= existing.updatedAt) {
      summaries.set(key, summary);
    }
  }
  return [...summaries.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SELECTED_MODEL_SUMMARIES);
}

export function findHermesSelectedModelSummary(
  summaries: HermesSelectedModelSummary[],
  provider: string,
  model: string,
): HermesSelectedModelSummary | undefined {
  const key = hermesSelectedModelSummaryKey(provider, model);
  return summaries.find(
    (summary) =>
      hermesSelectedModelSummaryKey(summary.provider, summary.model) === key,
  );
}

let selectedModelSummariesCache: HermesSelectedModelSummary[] | null = null;
let selectedModelSummariesRead: Promise<HermesSelectedModelSummary[]> | null =
  null;
let selectedModelSummariesWrite: Promise<void> = Promise.resolve();

async function readSelectedModelSummaries(): Promise<
  HermesSelectedModelSummary[]
> {
  if (selectedModelSummariesCache) return selectedModelSummariesCache;
  if (selectedModelSummariesRead) return selectedModelSummariesRead;
  selectedModelSummariesRead = (async () => {
    try {
      const result = await getPlatform().storage.get(
        HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY,
      );
      selectedModelSummariesCache = normalizeHermesSelectedModelSummaries(
        result[HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY],
      );
    } catch {
      selectedModelSummariesCache = [];
    }
    return selectedModelSummariesCache;
  })();
  try {
    return await selectedModelSummariesRead;
  } finally {
    selectedModelSummariesRead = null;
  }
}

function mergeSummaryEntries(
  existing: HermesCatalogModelEntry | undefined,
  incoming: HermesCatalogModelEntry,
  model: string,
): HermesCatalogModelEntry {
  const description = incoming.description ?? existing?.description;
  const metadata =
    incoming.metadata || existing?.metadata
      ? {
          ...(existing?.metadata ?? {}),
          ...(incoming.metadata ?? {}),
        }
      : undefined;
  const existingSupplemental = existing?.supplemental;
  const incomingSupplemental = incoming.supplemental;
  const supplemental =
    incomingSupplemental || existingSupplemental
      ? {
          source:
            incomingSupplemental?.source ?? existingSupplemental?.source ?? "",
          description:
            incomingSupplemental?.description ??
            existingSupplemental?.description,
          metadata: {
            ...(existingSupplemental?.metadata ?? {}),
            ...(incomingSupplemental?.metadata ?? {}),
          },
        }
      : undefined;
  return {
    id: model,
    ...(description ? { description } : {}),
    ...(metadata ? { metadata } : {}),
    ...(supplemental?.source
      ? {
          supplemental: {
            source: supplemental.source,
            ...(supplemental.description
              ? { description: supplemental.description }
              : {}),
            metadata: supplemental.metadata,
          },
        }
      : {}),
  };
}

function writeSelectedModelSummaries(
  incoming: HermesSelectedModelSummary[],
): Promise<void> {
  if (!incoming.length) return Promise.resolve();
  selectedModelSummariesWrite = selectedModelSummariesWrite
    .catch(() => undefined)
    .then(async () => {
      const current = await readSelectedModelSummaries();
      const merged = new Map(
        current.map((summary) => [
          hermesSelectedModelSummaryKey(summary.provider, summary.model),
          summary,
        ]),
      );
      for (const summary of incoming) {
        const key = hermesSelectedModelSummaryKey(
          summary.provider,
          summary.model,
        );
        const existing = merged.get(key);
        merged.set(key, {
          ...summary,
          entry: mergeSummaryEntries(
            existing?.entry,
            summary.entry,
            summary.model,
          ),
        });
      }
      const next = [...merged.values()]
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_SELECTED_MODEL_SUMMARIES);
      selectedModelSummariesCache = next;
      await getPlatform().storage.set({
        [HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY]: {
          version: 1,
          items: next,
        },
      });
    })
    .catch(() => undefined);
  return selectedModelSummariesWrite;
}

function watchSelectedModelSummaries(
  listener: (summaries: HermesSelectedModelSummary[]) => void,
): () => void {
  try {
    return getPlatform().storage.watch(
      HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY,
      (changes) => {
        const change = changes[HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY];
        if (!change) return;
        const next = normalizeHermesSelectedModelSummaries(change.newValue);
        selectedModelSummariesCache = next;
        listener(next);
      },
    );
  } catch {
    return () => {};
  }
}

function displayPreferencesStorageKey(profileId?: string): string {
  const profile = cleanId(profileId).toLowerCase();
  return !profile || profile === "default"
    ? HERMES_MODEL_DISPLAY_PREFS_STORAGE_KEY
    : `${HERMES_MODEL_DISPLAY_PREFS_STORAGE_KEY}.${encodeURIComponent(profile)}`;
}

async function readDisplayPreferences(
  profileId?: string,
): Promise<HermesModelDisplayPreferences> {
  const storageKey = displayPreferencesStorageKey(profileId);
  try {
    const result = await getPlatform().storage.get(storageKey);
    return normalizeHermesModelDisplayPreferences(result[storageKey]);
  } catch {
    return normalizeHermesModelDisplayPreferences(null);
  }
}

async function writeDisplayPreferences(
  preferences: HermesModelDisplayPreferences,
  profileId?: string,
): Promise<HermesModelDisplayPreferences> {
  const normalized = normalizeHermesModelDisplayPreferences(preferences);
  const storageKey = displayPreferencesStorageKey(profileId);
  await getPlatform().storage.set({
    [storageKey]: normalized,
  });
  return normalized;
}

async function setProviderVisibility(
  provider: string,
  visible: boolean,
  profileId?: string,
): Promise<HermesModelDisplayPreferences> {
  const slug = cleanId(provider);
  const current = await readDisplayPreferences(profileId);
  if (!slug) return current;
  return writeDisplayPreferences(
    {
      ...current,
      providerOverrides: {
        ...current.providerOverrides,
        [slug]: visible,
      },
    },
    profileId,
  );
}

async function setModelVisibility(
  provider: string,
  model: string,
  visible: boolean,
  profileId?: string,
): Promise<HermesModelDisplayPreferences> {
  const slug = cleanId(provider);
  const modelId = cleanId(model);
  const current = await readDisplayPreferences(profileId);
  if (!slug || !modelId) return current;

  const hidden = new Set(current.hiddenModels[slug] ?? []);
  if (visible) hidden.delete(modelId);
  else hidden.add(modelId);

  const hiddenModels = { ...current.hiddenModels };
  if (hidden.size) hiddenModels[slug] = [...hidden];
  else delete hiddenModels[slug];

  return writeDisplayPreferences(
    {
      ...current,
      hiddenModels,
    },
    profileId,
  );
}

function watchDisplayPreferences(
  listener: (preferences: HermesModelDisplayPreferences) => void,
  profileId?: string,
): () => void {
  const storageKey = displayPreferencesStorageKey(profileId);
  try {
    return getPlatform().storage.watch(storageKey, (changes) => {
      const change = changes[storageKey];
      if (!change) return;
      listener(normalizeHermesModelDisplayPreferences(change.newValue));
    });
  } catch {
    return () => {};
  }
}

function providerSource(
  slug: string,
  configSet: Set<string>,
  envSet: Set<string>,
  authenticatedSet: Set<string>,
): HermesProviderConnectionSource {
  if (configSet.has(slug)) return "config";
  if (envSet.has(slug)) return "saved-credentials";
  if (authenticatedSet.has(slug)) return "detected-credentials";
  return "available";
}

function isLoopbackUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.includes("://localhost") ||
    normalized.includes("://127.0.0.1") ||
    normalized.includes("://[::1]")
  );
}

/**
 * Classify exactly once at the Amiba↔Hermes boundary.
 *
 * The minimum supported Hermes version guarantees `source/auth_type=virtual`,
 * so classification never falls back to provider-specific slug checks.
 */
export function classifyHermesProvider(
  slug: string,
  block: HermesCatalogProviderBlock | undefined,
): HermesProviderKind {
  const source = cleanId(block?.source).toLowerCase();
  const authType = cleanId(block?.auth_type).toLowerCase();
  if (source === "virtual" || authType === "virtual") {
    return "virtual";
  }
  if (
    authType === "external_process" ||
    authType === "external-process" ||
    cleanId(block?.default_base_url).toLowerCase().startsWith("acp://")
  ) {
    return "process";
  }
  if (
    slug === "local" ||
    slug === "lmstudio" ||
    isLoopbackUrl(cleanId(block?.default_base_url))
  ) {
    return "local";
  }
  return "remote";
}

/**
 * Normalize Hermes's catalog/auth/config signals into the one provider view
 * every Amiba model surface consumes.
 */
export function buildHermesModelProviderViews(
  catalog: HermesModelCatalogResponse | null,
  current: Partial<HermesAgentMainModelResponse>,
  preferences: HermesModelDisplayPreferences,
): HermesModelProviderView[] {
  if (!catalog?.ok) return [];

  const currentProvider = cleanId(current.provider);
  const currentModel = cleanId(current.model);
  const configSet = new Set(uniqueStrings(catalog.config_provider_ids ?? []));
  const envSet = new Set(uniqueStrings(catalog.env_ready_provider_ids ?? []));
  const authenticatedSet = new Set(
    uniqueStrings(catalog.authenticated_provider_ids ?? []),
  );
  const labels = new Map(
    (catalog.canonical_providers ?? []).map((provider) => [
      cleanId(provider.slug),
      cleanId(provider.label) ||
        cleanId(provider.tui_desc) ||
        cleanId(provider.slug),
    ]),
  );
  const providerOrder = uniqueStrings([
    ...(catalog.config_provider_ids ?? []),
    ...(catalog.env_ready_provider_ids ?? []),
    currentProvider,
    ...(catalog.authenticated_provider_ids ?? []),
    ...(catalog.provider_ids ?? []),
    ...Object.keys(catalog.providers ?? {}),
  ]);

  return providerOrder.map((slug) => {
    const providerBlock = catalog.providers?.[slug];
    const source = providerSource(slug, configSet, envSet, authenticatedSet);
    const isCurrentProvider = slug === currentProvider;
    const hiddenModels = new Set(preferences.hiddenModels[slug] ?? []);
    const models: HermesModelDisplayEntry[] = [];
    const seenModels = new Set<string>();
    const currentHermesMetadata: Record<string, unknown> = {};
    if (isCurrentProvider && currentModel) {
      const capabilities = current.capabilities ?? {};
      const effectiveContext =
        positiveNumber(current.effective_context_length) ??
        positiveNumber(capabilities.context_window) ??
        positiveNumber(current.auto_context_length);
      if (effectiveContext) {
        currentHermesMetadata.context_window = effectiveContext;
        currentHermesMetadata.context_source = "hermes-runtime";
      }
      const maxOutput = positiveNumber(capabilities.max_output_tokens);
      if (maxOutput) {
        currentHermesMetadata.max_output_tokens = maxOutput;
      }
      if (typeof capabilities.supports_tools === "boolean") {
        currentHermesMetadata.supports_tools = capabilities.supports_tools;
      }
      if (typeof capabilities.supports_vision === "boolean") {
        currentHermesMetadata.supports_vision = capabilities.supports_vision;
      }
      if (typeof capabilities.supports_reasoning === "boolean") {
        currentHermesMetadata.supports_reasoning =
          capabilities.supports_reasoning;
      }
      const family = cleanId(capabilities.model_family);
      if (family) currentHermesMetadata.model_family = family;
      if (Object.keys(capabilities).length > 0) {
        currentHermesMetadata.capabilities_source = "hermes-model-info";
      }
    }
    const pushModel = (entry: HermesCatalogModelEntry) => {
      const id = cleanId(entry.id);
      if (!id || seenModels.has(id)) return;
      seenModels.add(id);
      const isCurrentModel = isCurrentProvider && id === currentModel;
      models.push({
        ...entry,
        id,
        current: isCurrentModel,
        visible: isCurrentModel || !hiddenModels.has(id),
      });
    };

    const catalogEntries = providerBlock?.models ?? [];
    if (isCurrentProvider && currentModel) {
      const catalogEntry = catalogEntries.find(
        (entry) => cleanId(entry.id) === currentModel,
      );
      const metadata = {
        ...(catalogEntry?.metadata ?? {}),
        ...currentHermesMetadata,
      };
      pushModel({
        ...(catalogEntry ?? { id: currentModel }),
        id: currentModel,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      });
    }
    for (const entry of catalogEntries) {
      pushModel(entry);
    }

    const explicitlyConfigured =
      source === "config" || source === "saved-credentials";
    // Configuration and credentials are intentionally separate. A provider
    // listed in config.yaml is not executable until the selected Profile has
    // an effective local/shared/system credential accepted by the backend.
    const authenticated =
      authenticatedSet.has(slug) || providerBlock?.authenticated === true;
    const selectable = models.length > 0 && authenticated;
    const preference = preferences.providerOverrides[slug];
    const visible =
      selectable &&
      (isCurrentProvider ||
        (typeof preference === "boolean" ? preference : false));

    return {
      id: slug,
      label: labels.get(slug) || slug,
      kind: classifyHermesProvider(slug, providerBlock),
      source,
      catalogSource: cleanId(providerBlock?.source) || undefined,
      authType: cleanId(providerBlock?.auth_type) || undefined,
      warning: cleanId(providerBlock?.warning) || undefined,
      connection: providerBlock?.connection,
      authenticated,
      explicitlyConfigured,
      current: isCurrentProvider,
      selectable,
      visible,
      models,
    };
  });
}

export function buildHermesModelPickerGroups(
  providers: HermesModelProviderView[],
): HermesModelPickerGroup[] {
  return providers.flatMap((provider) => {
    if (
      provider.kind === "virtual" ||
      !provider.visible ||
      !provider.selectable
    ) {
      return [];
    }
    const models = provider.models
      .filter((model) => model.visible)
      .map(({ id, description, metadata, supplemental }) => ({
        id,
        ...(description ? { description } : {}),
        ...(metadata ? { metadata } : {}),
        ...(supplemental ? { supplemental } : {}),
      }));
    return models.length
      ? [
          {
            provider: provider.id,
            label: provider.label,
            models,
          },
        ]
      : [];
  });
}

export function getHermesModelSlotStatus(
  slot: HermesMoaModelSlot,
  providers: HermesModelProviderView[],
): HermesVirtualDependencyStatus {
  const provider = providers.find((entry) => entry.id === slot.provider);
  if (!provider?.selectable) return "provider-unavailable";
  if (!provider.visible) return "provider-hidden";
  const model = provider.models.find((entry) => entry.id === slot.model);
  if (!model) return "model-unavailable";
  return model.visible ? "ready" : "model-hidden";
}

export function isHermesModelSlotEnabled(
  slot: HermesMoaModelSlot,
  providers: HermesModelProviderView[],
): boolean {
  return getHermesModelSlotStatus(slot, providers) === "ready";
}

function dependencyForSlot(
  slot: HermesMoaModelSlot,
  role: HermesVirtualDependencyRole,
  index: number,
  serviceProviders: HermesModelProviderView[],
): HermesVirtualCapabilityDependency {
  const provider = serviceProviders.find((entry) => entry.id === slot.provider);
  return {
    ...slot,
    role,
    index,
    providerLabel: provider?.label || slot.provider,
    status: getHermesModelSlotStatus(slot, serviceProviders),
  };
}

/**
 * Convert Hermes's virtual provider plus MoA preset config into a capability
 * dependency graph. This keeps UI components free of provider-auth heuristics.
 */
export function buildHermesVirtualCapabilityViews(
  providers: HermesModelProviderView[],
  moa: HermesMoaConfigResponse,
): HermesVirtualCapabilityView[] {
  const virtualProvider = providers.find(
    (provider) => provider.kind === "virtual" && provider.id === "moa",
  );
  if (!virtualProvider || !moa.ok) return [];

  const serviceProviders = providers.filter(
    (provider) => provider.kind !== "virtual",
  );
  const presets = Object.entries(moa.presets ?? {}).map(([id, config]) => {
    const references = (config.reference_models ?? []).map((slot, index) =>
      dependencyForSlot(slot, "reference", index, serviceProviders),
    );
    const aggregator = dependencyForSlot(
      config.aggregator,
      "aggregator",
      0,
      serviceProviders,
    );
    const dependencies = [...references, aggregator];
    const aggregatorReady = aggregator.status === "ready";
    const allReferencesReady = references
      .filter((dependency) => dependency.enabled !== false)
      .every((dependency) => dependency.status === "ready");
    const status: HermesVirtualCapabilityStatus = !config.enabled
      ? "disabled"
      : !aggregatorReady
        ? "unavailable"
        : allReferencesReady
          ? "ready"
          : "degraded";
    return {
      id,
      enabled: Boolean(config.enabled),
      current: virtualProvider.models.some(
        (model) => model.id === id && model.current,
      ),
      status,
      config,
      dependencies,
    };
  });

  return [
    {
      id: "moa",
      provider: virtualProvider.id,
      label: virtualProvider.label,
      current: virtualProvider.current,
      configured: Boolean(moa.configured),
      defaultPreset: moa.default_preset,
      activePreset: moa.active_preset,
      presets,
    },
  ];
}

export function buildHermesVirtualCapabilityPickerGroups(
  capabilities: HermesVirtualCapabilityView[],
): HermesVirtualCapabilityPickerGroup[] {
  return capabilities.flatMap((capability) => {
    const models = capability.presets
      .filter(
        (preset) =>
          preset.current || (preset.enabled && preset.status !== "unavailable"),
      )
      .map((preset) => ({ id: preset.id }));
    return models.length
      ? [
          {
            capability: capability.id,
            provider: capability.provider,
            label: capability.label,
            models,
          },
        ]
      : [];
  });
}

interface HermesModelReference {
  provider: string;
  model: string;
}

function collectConfiguredModelReferences(
  configuration: Pick<
    HermesModelConfigurationSnapshot,
    "auxiliary" | "main" | "moa"
  >,
): HermesModelReference[] {
  const references = new Map<string, HermesModelReference>();
  const add = (providerValue: unknown, modelValue: unknown) => {
    const provider = cleanId(providerValue);
    const model = cleanId(modelValue);
    if (!provider || provider === "auto" || !model) return;
    references.set(hermesSelectedModelSummaryKey(provider, model), {
      provider,
      model,
    });
  };

  add(configuration.main.provider, configuration.main.model);
  for (const task of configuration.auxiliary.tasks ?? []) {
    add(task.provider, task.model);
  }
  for (const preset of Object.values(configuration.moa.presets ?? {})) {
    for (const slot of preset.reference_models ?? []) {
      add(slot.provider, slot.model);
    }
    add(preset.aggregator?.provider, preset.aggregator?.model);
  }
  return [...references.values()];
}

function rememberModelReferences(
  references: HermesModelReference[],
  catalog: HermesModelCatalogResponse | null,
  current: Partial<HermesAgentMainModelResponse> = {},
  preferences: HermesModelDisplayPreferences = DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
): Promise<void> {
  if (!catalog?.ok || !references.length) return Promise.resolve();
  const providers = buildHermesModelProviderViews(
    catalog,
    current,
    preferences,
  );
  const rememberedAt = Date.now();
  const summaries = references.flatMap(
    ({ provider: providerId, model: modelId }) => {
      const entry = providers
        .find((provider) => provider.id === providerId)
        ?.models.find((model) => model.id === modelId);
      if (!entry) return [];
      return [
        {
          provider: providerId,
          model: modelId,
          entry: {
            id: modelId,
            ...(entry.description ? { description: entry.description } : {}),
            ...(entry.metadata ? { metadata: entry.metadata } : {}),
            ...(entry.supplemental ? { supplemental: entry.supplemental } : {}),
          },
          updatedAt: rememberedAt,
        },
      ];
    },
  );
  return writeSelectedModelSummaries(summaries);
}

function rememberConfigurationModels(
  configuration: HermesModelConfigurationSnapshot,
  catalog: HermesModelCatalogResponse | null,
): Promise<void> {
  return rememberModelReferences(
    collectConfiguredModelReferences(configuration),
    catalog,
    configuration.main,
    configuration.displayPreferences,
  );
}

const MODEL_CATALOG_MEMORY_TTL_MS = 5 * 60 * 1000;
interface ModelCatalogMemoryState {
  catalog: HermesModelCatalogResponse | null;
  cachedAt: number;
  request: Promise<HermesModelCatalogResponse> | null;
  configuration: HermesModelConfigurationSnapshot | null;
  listeners: Set<(catalog: HermesModelCatalogResponse) => void>;
}

const modelCatalogStates = new Map<string, ModelCatalogMemoryState>();

function modelProfileKey(profileId?: string): string {
  const id = cleanId(profileId);
  return !id || id.toLowerCase() === "default" ? "default" : id;
}

function modelCatalogState(profileId?: string): ModelCatalogMemoryState {
  const key = modelProfileKey(profileId);
  const current = modelCatalogStates.get(key);
  if (current) return current;
  const created: ModelCatalogMemoryState = {
    catalog: null,
    cachedAt: 0,
    request: null,
    configuration: null,
    listeners: new Set(),
  };
  modelCatalogStates.set(key, created);
  return created;
}

function publishModelCatalog(
  catalog: HermesModelCatalogResponse,
  profileId?: string,
): void {
  if (!catalog.ok) return;
  const state = modelCatalogState(profileId);
  state.catalog = catalog;
  state.cachedAt = Date.now();
  for (const listener of state.listeners) listener(catalog);
  if (state.configuration) {
    void rememberConfigurationModels(state.configuration, catalog);
  }
}

async function requestModelCatalog(
  refresh = false,
  profileId?: string,
): Promise<HermesModelCatalogResponse> {
  const state = modelCatalogState(profileId);
  if (state.request) return state.request;
  state.request = getHermesModelCatalog(
    refresh,
    modelProfileKey(profileId) === "default" ? undefined : profileId,
  );
  try {
    const catalog = await state.request;
    publishModelCatalog(catalog, profileId);
    return catalog;
  } finally {
    state.request = null;
  }
}

/**
 * Return the shared in-process catalog immediately when possible. A stale
 * snapshot remains usable while one background request refreshes it.
 */
function readModelCatalog(
  refresh = false,
  profileId?: string,
): Promise<HermesModelCatalogResponse> {
  const state = modelCatalogState(profileId);
  if (refresh) return requestModelCatalog(true, profileId);
  if (!state.catalog) return requestModelCatalog(false, profileId);
  if (Date.now() - state.cachedAt >= MODEL_CATALOG_MEMORY_TTL_MS) {
    void requestModelCatalog(false, profileId);
  }
  return Promise.resolve(state.catalog);
}

function peekModelCatalog(
  profileId?: string,
): HermesModelCatalogResponse | null {
  return modelCatalogState(profileId).catalog;
}

function watchModelCatalog(
  listener: (catalog: HermesModelCatalogResponse) => void,
  profileId?: string,
): () => void {
  const listeners = modelCatalogState(profileId).listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readConfiguration(
  profileId?: string,
): Promise<HermesModelConfigurationSnapshot> {
  const [main, auxiliary, moa, displayPreferences, selectedModelSummaries] =
    await Promise.all([
      getHermesMainModelInfo(profileId),
      getHermesAuxiliaryModels(profileId),
      getHermesMoaConfig(profileId),
      readDisplayPreferences(profileId),
      readSelectedModelSummaries(),
    ]);
  const configuration = {
    main,
    auxiliary,
    moa,
    displayPreferences,
    selectedModelSummaries,
  };
  const state = modelCatalogState(profileId);
  state.configuration = configuration;
  if (state.catalog) {
    void rememberConfigurationModels(configuration, state.catalog);
  }
  return configuration;
}

async function readWorkspace(
  refresh = false,
  profileId?: string,
): Promise<HermesModelWorkspaceSnapshot> {
  const [configuration, catalog] = await Promise.all([
    readConfiguration(profileId),
    readModelCatalog(refresh, profileId),
  ]);
  const { main, auxiliary, moa, displayPreferences, selectedModelSummaries } =
    configuration;
  const allProviders = buildHermesModelProviderViews(
    catalog,
    main,
    displayPreferences,
  );
  return {
    main,
    catalog,
    auxiliary,
    moa,
    displayPreferences,
    selectedModelSummaries,
    providers: allProviders.filter((provider) => provider.kind !== "virtual"),
    virtualProviders: allProviders.filter(
      (provider) => provider.kind === "virtual",
    ),
    virtualCapabilities: buildHermesVirtualCapabilityViews(allProviders, moa),
  };
}

async function readCurrentModelIdentity(
  profileId?: string,
): Promise<HermesCurrentModelIdentitySnapshot> {
  const [main, summaries] = await Promise.all([
    getHermesMainModelInfo(profileId),
    readSelectedModelSummaries(),
  ]);
  const current = {
    provider: cleanId(main.provider) || "auto",
    model: cleanId(main.model),
  };
  return {
    ok: main.ok,
    error: main.error,
    current,
    summary: findHermesSelectedModelSummary(
      summaries,
      current.provider,
      current.model,
    ),
  };
}

async function readPicker(
  profileId?: string,
): Promise<HermesModelPickerSnapshot> {
  const [main, catalog, moa, preferences] = await Promise.all([
    getHermesMainModelInfo(profileId),
    readModelCatalog(false, profileId),
    getHermesMoaConfig(profileId),
    readDisplayPreferences(profileId),
  ]);
  const current = {
    provider: cleanId(main.provider) || "auto",
    model: cleanId(main.model),
  };
  const providers = buildHermesModelProviderViews(catalog, main, preferences);
  const virtualCapabilities = buildHermesVirtualCapabilityViews(providers, moa);
  void rememberModelReferences([current], catalog, main, preferences);
  return {
    ok: main.ok && catalog.ok,
    error: main.error || catalog.error,
    current,
    groups: buildHermesModelPickerGroups(providers),
    capabilities: buildHermesVirtualCapabilityPickerGroups(virtualCapabilities),
  };
}

async function writeMainModel(
  patch: {
    provider: string;
    model: string;
    base_url?: string | null;
  },
  profileId?: string,
): Promise<HermesAgentMainModelResponse> {
  const result = await setHermesAgentMainModel(patch, profileId);
  if (!result.ok) return result;
  const provider = cleanId(result.provider) || cleanId(patch.provider);
  const model = cleanId(result.model) || cleanId(patch.model);
  const state = modelCatalogState(profileId);
  if (state.configuration) {
    state.configuration = {
      ...state.configuration,
      main: result,
    };
  }
  void rememberModelReferences(
    [{ provider, model }],
    state.catalog,
    result,
    state.configuration?.displayPreferences,
  );
  return result;
}

async function writeAuxiliaryModel(
  patch: {
    task: AuxiliarySlotName;
    provider?: string;
    model?: string;
  },
  profileId?: string,
): Promise<AuxiliaryModelsResponse> {
  const result = await setHermesAuxiliarySlot(patch, profileId);
  if (!result.ok) return result;
  const state = modelCatalogState(profileId);
  if (state.configuration) {
    state.configuration = {
      ...state.configuration,
      auxiliary: result,
    };
  }
  const provider = cleanId(patch.provider);
  const model = cleanId(patch.model);
  if (provider && model) {
    void rememberModelReferences(
      [{ provider, model }],
      state.catalog,
      state.configuration?.main,
      state.configuration?.displayPreferences,
    );
  }
  return result;
}

async function writeMoaConfiguration(
  config: Pick<
    HermesMoaConfigResponse,
    "default_preset" | "active_preset" | "presets" | "privacy_filter"
  >,
  profileId?: string,
): Promise<HermesMoaConfigResponse> {
  const result = await saveHermesMoaConfig(config, profileId);
  if (!result.ok) return result;
  const state = modelCatalogState(profileId);
  if (state.configuration) {
    state.configuration = {
      ...state.configuration,
      moa: result,
    };
    void rememberConfigurationModels(state.configuration, state.catalog);
  } else {
    void rememberModelReferences(
      collectConfiguredModelReferences({
        main: { ok: true },
        auxiliary: { ok: true },
        moa: result,
      }),
      state.catalog,
    );
  }
  return result;
}

async function readProviderModels(
  provider: string,
  refresh = false,
  profileId?: string,
): Promise<HermesProviderModelsResponse> {
  const result = await getHermesProviderModels(provider, refresh, profileId);
  const providerId = cleanId(result.provider) || cleanId(provider);
  const state = modelCatalogState(profileId);
  if (result.ok && providerId && result.models?.length && state.configuration) {
    const references = collectConfiguredModelReferences(
      state.configuration,
    ).filter((reference) => reference.provider === providerId);
    void rememberModelReferences(
      references,
      {
        ok: true,
        provider_ids: [providerId],
        config_provider_ids: [providerId],
        authenticated_provider_ids: [providerId],
        providers: {
          [providerId]: {
            authenticated: true,
            models: result.models,
          },
        },
      },
      state.configuration.main,
      state.configuration.displayPreferences,
    );
  }
  return result;
}

/**
 * The only model-service object UI code should call.
 *
 * The low-level functions in `hermes-agent-model.ts` remain the transport
 * adapter and wire-shape test seam; this facade is the Amiba domain contract.
 */
export const hermesModelGateway = {
  workspace: {
    read: readWorkspace,
    readConfiguration,
  },
  picker: {
    read: readPicker,
    readCurrent: readCurrentModelIdentity,
  },
  main: {
    read: getHermesMainModelInfo,
    write: writeMainModel,
  },
  auxiliary: {
    read: getHermesAuxiliaryModels,
    write: writeAuxiliaryModel,
  },
  virtualCapabilities: {
    readMoa: getHermesMoaConfig,
    writeMoa: writeMoaConfiguration,
  },
  catalog: {
    peek: peekModelCatalog,
    read: readModelCatalog,
    watch: watchModelCatalog,
  },
  summaries: {
    read: readSelectedModelSummaries,
    watch: watchSelectedModelSummaries,
  },
  provider: {
    readModels: readProviderModels,
    readCredentials: (
      provider: string,
      verify = true,
      profileId?: string,
    ): Promise<HermesProviderCredentialsResponse> =>
      getHermesProviderCredentials(provider, verify, profileId),
    writeCredentials: (
      provider: string,
      values: Record<string, string>,
      profileId?: string,
    ) => saveHermesProviderCredentials(provider, values, profileId),
  },
  display: {
    read: readDisplayPreferences,
    write: writeDisplayPreferences,
    setProviderVisibility,
    setModelVisibility,
    watch: watchDisplayPreferences,
  },
} as const;
