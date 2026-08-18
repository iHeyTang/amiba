import type {
  AgentCredentialView,
  AgentModelSelection,
  ModelDefinition,
} from "@amiba/app-runtime/platform";

import type {
  ModelPlaneAdapter,
  ModelPlaneSnapshot,
  ModelProviderProfile,
} from "./types.js";

import {
  MODEL_REGISTRY_VERSION,
  credentialRefFor,
  defaultSelectionOf,
  groupsOf,
  normalizeProvider,
  normalizeRegistry,
  publicProvider,
  type StoredModelProvider,
  type StoredModelRegistry,
} from "./core.js";
import { discoverModelsFromProvider } from "./discovery.js";
import {
  applyModelProviderCapabilities,
  builtInModelProviders,
} from "./drivers.js";

export interface ModelPlaneStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(patch: Record<string, unknown>): Promise<void>;
}

export interface ModelCredentialVault {
  describe(
    refs: readonly string[],
  ): Promise<Record<string, AgentCredentialView>>;
  resolve(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  unset(ref: string): Promise<void>;
}

/** Optional execution projection. The canonical registry never depends on it. */
export interface ModelProviderProjection {
  project(provider: ModelProviderProfile): Promise<void>;
  remove(provider: ModelProviderProfile): Promise<void>;
  unsetCredential(ref: string): Promise<void>;
}

export interface ModelPlaneServiceOptions {
  store: ModelPlaneStore;
  vault: ModelCredentialVault;
  projection?: ModelProviderProjection;
  storageKey?: string;
  builtIns?: () => ModelProviderProfile[];
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_STORAGE_KEY = "modelPlane.registry.v1";

/**
 * Canonical provider/model/credential service. It is usable without DSH; an
 * execution harness participates only through the optional projection port.
 */
export class ModelPlaneService implements ModelPlaneAdapter {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly storageKey: string;

  constructor(private readonly options: ModelPlaneServiceOptions) {
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    let resolveCurrent: (() => void) | undefined;
    const previous = this.mutationQueue;
    this.mutationQueue = new Promise<void>((resolve) => {
      resolveCurrent = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      resolveCurrent?.();
    }
  }

  private async bootstrapRegistry(): Promise<StoredModelRegistry> {
    const registry: StoredModelRegistry = {
      version: MODEL_REGISTRY_VERSION,
      revision: 1,
      providers: (this.options.builtIns ?? builtInModelProviders)(),
      projectionFailures: [],
    };
    await this.options.store.set({ [this.storageKey]: registry });
    return registry;
  }

  private async readRegistry(): Promise<StoredModelRegistry> {
    const stored = await this.options.store.get(this.storageKey);
    const registry = normalizeRegistry(stored[this.storageKey]);
    if (!registry) return this.bootstrapRegistry();
    return {
      ...registry,
      providers: registry.providers.map(applyModelProviderCapabilities),
    };
  }

  private assertRevision(
    registry: StoredModelRegistry,
    expected?: number,
  ): void {
    if (expected !== undefined && registry.revision !== expected) {
      throw new Error(
        `Model Plane revision conflict: expected ${expected}, current ${registry.revision}`,
      );
    }
  }

  private async writeRegistry(
    registry: StoredModelRegistry,
    patch: Partial<
      Pick<
        StoredModelRegistry,
        "providers" | "defaultSelection" | "projectionFailures"
      >
    >,
  ): Promise<StoredModelRegistry> {
    const next: StoredModelRegistry = {
      ...registry,
      ...patch,
      revision: registry.revision + 1,
    };
    await this.options.store.set({ [this.storageKey]: next });
    return next;
  }

  private async snapshotOf(
    registry: StoredModelRegistry,
  ): Promise<ModelPlaneSnapshot> {
    const refs = registry.providers.flatMap((provider) =>
      provider.credentialRef ? [provider.credentialRef] : [],
    );
    const defaultSelection = defaultSelectionOf(registry);
    return {
      revision: registry.revision,
      providers: registry.providers.map(publicProvider),
      groups: groupsOf(registry.providers),
      ...(defaultSelection ? { defaultSelection } : {}),
      credentials: await this.options.vault.describe(refs),
      failures: registry.projectionFailures,
    };
  }

  private async recordProjectionFailure(
    registry: StoredModelRegistry,
    provider: StoredModelProvider,
    error: unknown,
  ): Promise<StoredModelRegistry> {
    return this.writeRegistry(registry, {
      projectionFailures: [
        ...registry.projectionFailures.filter(
          (failure) => failure.id !== provider.id,
        ),
        {
          id: provider.id,
          name: provider.displayName,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    });
  }

  async snapshot(): Promise<ModelPlaneSnapshot> {
    return this.snapshotOf(await this.readRegistry());
  }

  async setDefaultSelection(
    selection: AgentModelSelection,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot> {
    return this.serialized(async () => {
      const registry = await this.readRegistry();
      this.assertRevision(registry, expectedRevision);
      const normalized = defaultSelectionOf({
        providers: registry.providers,
        defaultSelection: selection,
      });
      if (
        !normalized ||
        normalized.provider !== selection.provider ||
        normalized.model !== selection.model
      ) {
        throw new Error("The selected model is not enabled in Model Plane");
      }
      return this.snapshotOf(
        await this.writeRegistry(registry, {
          defaultSelection: normalized,
        }),
      );
    });
  }

  async upsert(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
    expectedRevision?: number;
  }): Promise<ModelPlaneSnapshot> {
    return this.serialized(async () => {
      let registry = await this.readRegistry();
      this.assertRevision(registry, input.expectedRevision);
      const existing = registry.providers.find(
        (provider) => provider.id === input.provider.id,
      );
      if (existing && !existing.editable) {
        throw new Error(`Model provider ${existing.id} is read-only`);
      }
      const credentialRef =
        input.provider.credentialRef ??
        (input.apiKey?.trim()
          ? credentialRefFor(input.provider.id)
          : undefined);
      if (input.apiKey?.trim() && credentialRef) {
        await this.options.vault.set(credentialRef, input.apiKey);
      }
      const provider = normalizeProvider({
        ...applyModelProviderCapabilities({
          ...input.provider,
          source: existing?.source ?? "user",
        }),
        ...(credentialRef ? { credentialRef } : {}),
      });
      if (!provider)
        throw new Error("Invalid Model Plane provider configuration");

      const index = registry.providers.findIndex(
        (entry) => entry.id === provider.id,
      );
      const providers = [...registry.providers];
      if (index >= 0) providers[index] = provider;
      else providers.push(provider);
      registry = await this.writeRegistry(registry, {
        providers,
        projectionFailures: registry.projectionFailures.filter(
          (failure) => failure.id !== provider.id,
        ),
      });
      if (this.options.projection) {
        try {
          await this.options.projection.project(provider);
        } catch (error) {
          registry = await this.recordProjectionFailure(
            registry,
            provider,
            error,
          );
        }
      }
      return this.snapshotOf(registry);
    });
  }

  async remove(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot> {
    return this.serialized(async () => {
      let registry = await this.readRegistry();
      this.assertRevision(registry, expectedRevision);
      const provider = registry.providers.find(
        (entry) => entry.id === providerId,
      );
      if (!provider) return this.snapshotOf(registry);
      if (provider.source !== "user") {
        throw new Error("Built-in or imported providers cannot be removed");
      }
      registry = await this.writeRegistry(registry, {
        providers: registry.providers.filter(
          (entry) => entry.id !== providerId,
        ),
        projectionFailures: registry.projectionFailures.filter(
          (failure) => failure.id !== providerId,
        ),
      });
      if (this.options.projection) {
        try {
          await this.options.projection.remove(provider);
        } catch (error) {
          registry = await this.recordProjectionFailure(
            registry,
            provider,
            error,
          );
        }
      }
      return this.snapshotOf(registry);
    });
  }

  async discover(input: {
    provider: ModelProviderProfile;
    apiKey?: string;
  }): Promise<{ models: ModelDefinition[] }> {
    return {
      models: await discoverModelsFromProvider(input.provider, {
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        resolveCredential: (ref) => this.options.vault.resolve(ref),
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      }),
    };
  }

  async unsetCredential(
    providerId: string,
    expectedRevision?: number,
  ): Promise<ModelPlaneSnapshot> {
    return this.serialized(async () => {
      let registry = await this.readRegistry();
      this.assertRevision(registry, expectedRevision);
      const provider = registry.providers.find(
        (entry) => entry.id === providerId,
      );
      if (!provider?.credentialRef) return this.snapshotOf(registry);
      await this.options.vault.unset(provider.credentialRef);
      registry = await this.writeRegistry(registry, {
        projectionFailures: registry.projectionFailures.filter(
          (failure) => failure.id !== provider.id,
        ),
      });
      if (this.options.projection) {
        try {
          await this.options.projection.unsetCredential(provider.credentialRef);
        } catch (error) {
          registry = await this.recordProjectionFailure(
            registry,
            provider,
            error,
          );
        }
      }
      return this.snapshotOf(registry);
    });
  }

  /** Strict execution boundary used by any harness adapter before a session starts. */
  async prepareProjection(providerId: string): Promise<void> {
    if (!this.options.projection) return;
    await this.serialized(async () => {
      let registry = await this.readRegistry();
      const provider = registry.providers.find(
        (entry) => entry.id === providerId && entry.enabled,
      );
      if (!provider) {
        throw new Error(
          `Model provider ${providerId} is not configured or enabled`,
        );
      }
      try {
        await this.options.projection!.project(provider);
        if (
          registry.projectionFailures.some(
            (failure) => failure.id === provider.id,
          )
        ) {
          registry = await this.writeRegistry(registry, {
            projectionFailures: registry.projectionFailures.filter(
              (failure) => failure.id !== provider.id,
            ),
          });
        }
      } catch (error) {
        await this.recordProjectionFailure(registry, provider, error);
        throw error;
      }
    });
  }
}
