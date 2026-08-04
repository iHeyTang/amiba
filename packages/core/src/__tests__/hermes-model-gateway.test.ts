import { describe, expect, it } from "vitest";

import {
  DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
  buildHermesModelPickerGroups,
  buildHermesModelProviderViews,
  buildHermesVirtualCapabilityPickerGroups,
  buildHermesVirtualCapabilityViews,
  classifyHermesProvider,
  findHermesSelectedModelSummary,
  normalizeHermesModelDisplayPreferences,
  normalizeHermesSelectedModelSummaries,
} from "../hermes-model-gateway";
import type { HermesModelCatalogResponse } from "../hermes-agent-model";

const catalog: HermesModelCatalogResponse = {
  ok: true,
  providers: {
    configured: {
      models: [{ id: "configured-a" }, { id: "configured-b" }],
    },
    ambient: {
      models: [{ id: "ambient-a" }],
    },
    unavailable: {
      models: [{ id: "unavailable-a" }],
    },
  },
  provider_ids: ["configured", "ambient", "unavailable"],
  config_provider_ids: ["configured"],
  env_ready_provider_ids: [],
  authenticated_provider_ids: ["configured", "ambient"],
  canonical_providers: [
    { slug: "configured", label: "Configured", tui_desc: "Configured" },
    { slug: "ambient", label: "Ambient", tui_desc: "Ambient" },
    { slug: "unavailable", label: "Unavailable", tui_desc: "Unavailable" },
  ],
};

describe("Hermes model display gateway", () => {
  it("does not infer virtual providers from legacy slugs", () => {
    expect(classifyHermesProvider("moa", { models: [] })).toBe("remote");
    expect(
      classifyHermesProvider("any-capability", {
        auth_type: "virtual",
        models: [],
      }),
    ).toBe("virtual");
  });

  it("keeps the current provider visible but hides other providers by default", () => {
    const providers = buildHermesModelProviderViews(
      catalog,
      { provider: "configured", model: "configured-b" },
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );

    expect(
      providers.map(({ id, source, visible, selectable }) => ({
        id,
        source,
        visible,
        selectable,
      })),
    ).toEqual([
      {
        id: "configured",
        source: "config",
        visible: true,
        selectable: true,
      },
      {
        id: "ambient",
        source: "detected-credentials",
        visible: false,
        selectable: true,
      },
      {
        id: "unavailable",
        source: "available",
        visible: false,
        selectable: false,
      },
    ]);
    expect(buildHermesModelPickerGroups(providers)).toEqual([
      {
        provider: "configured",
        label: "Configured",
        models: [{ id: "configured-b" }, { id: "configured-a" }],
      },
    ]);
  });

  it("does not advertise configured credentials without an explicit display opt-in", () => {
    const providers = buildHermesModelProviderViews(
      catalog,
      {},
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );

    expect(
      providers.map(({ id, explicitlyConfigured, visible }) => ({
        id,
        explicitlyConfigured,
        visible,
      })),
    ).toEqual([
      {
        id: "configured",
        explicitlyConfigured: true,
        visible: false,
      },
      {
        id: "ambient",
        explicitlyConfigured: false,
        visible: false,
      },
      {
        id: "unavailable",
        explicitlyConfigured: false,
        visible: false,
      },
    ]);
    expect(buildHermesModelPickerGroups(providers)).toEqual([]);
  });

  it("does not treat config.yaml presence as executable credentials", () => {
    const configuredWithoutCredentials: HermesModelCatalogResponse = {
      ...catalog,
      authenticated_provider_ids: ["ambient"],
      providers: {
        ...catalog.providers,
        configured: {
          models: [{ id: "configured-a" }],
          authenticated: false,
        },
      },
    };
    const providers = buildHermesModelProviderViews(
      configuredWithoutCredentials,
      { provider: "configured", model: "configured-a" },
      {
        version: 1,
        providerOverrides: { configured: true },
        hiddenModels: {},
      },
    );

    expect(providers[0]).toMatchObject({
      explicitlyConfigured: true,
      authenticated: false,
      selectable: false,
      visible: false,
    });
    expect(buildHermesModelPickerGroups(providers)).toEqual([]);
  });

  it("merges every capability explicitly published by Hermes for the current model", () => {
    const richCatalog: HermesModelCatalogResponse = {
      ...catalog,
      providers: {
        ...catalog.providers,
        configured: {
          models: [
            { id: "configured-a" },
            {
              id: "configured-b",
              metadata: { temperature: true },
              supplemental: {
                source: "models.dev",
                description: "Configured B",
                metadata: {
                  context_window: 2_000_000,
                  reasoning: true,
                },
              },
            },
          ],
        },
      },
    };

    const providers = buildHermesModelProviderViews(
      richCatalog,
      {
        provider: "configured",
        model: "configured-b",
        effective_context_length: 1_000_000,
        capabilities: {
          supports_tools: true,
          supports_vision: false,
          supports_reasoning: true,
          max_output_tokens: 128_000,
          model_family: "configured-family",
        },
      },
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );

    const current = providers[0]?.models[0];
    expect(current).toEqual(
      expect.objectContaining({
        id: "configured-b",
        current: true,
        metadata: {
          temperature: true,
          context_window: 1_000_000,
          context_source: "hermes-runtime",
          max_output_tokens: 128_000,
          supports_tools: true,
          supports_vision: false,
          supports_reasoning: true,
          model_family: "configured-family",
          capabilities_source: "hermes-model-info",
        },
        supplemental:
          richCatalog.providers?.configured?.models[1]?.supplemental,
      }),
    );
    expect(buildHermesModelPickerGroups(providers)[0]?.models[0]).toEqual({
      id: "configured-b",
      metadata: current?.metadata,
      supplemental: current?.supplemental,
    });
  });

  it("allows an explicit opt-in for an ambient provider", () => {
    const providers = buildHermesModelProviderViews(
      catalog,
      { provider: "configured", model: "configured-a" },
      {
        version: 1,
        providerOverrides: { ambient: true },
        hiddenModels: {},
      },
    );

    expect(buildHermesModelPickerGroups(providers)).toEqual([
      {
        provider: "configured",
        label: "Configured",
        models: [{ id: "configured-a" }, { id: "configured-b" }],
      },
      {
        provider: "ambient",
        label: "Ambient",
        models: [{ id: "ambient-a" }],
      },
    ]);
  });

  it("hides individual models while preserving the active model", () => {
    const providers = buildHermesModelProviderViews(
      catalog,
      { provider: "configured", model: "configured-b" },
      {
        version: 1,
        providerOverrides: {},
        hiddenModels: {
          configured: ["configured-a", "configured-b"],
        },
      },
    );

    expect(buildHermesModelPickerGroups(providers)[0]?.models).toEqual([
      { id: "configured-b" },
    ]);
  });

  it("sanitizes persisted preferences before applying them", () => {
    expect(
      normalizeHermesModelDisplayPreferences({
        version: 99,
        providerOverrides: {
          " provider-a ": true,
          nope: "true",
        },
        hiddenModels: {
          " provider-a ": [" model-a ", "model-a", null],
          broken: "model-b",
        },
      }),
    ).toEqual({
      version: 1,
      providerOverrides: { "provider-a": true },
      hiddenModels: { "provider-a": ["model-a"] },
    });
  });

  it("normalizes remembered model summaries without merging supplemental provenance", () => {
    const summaries = normalizeHermesSelectedModelSummaries({
      version: 1,
      items: [
        {
          provider: " openai ",
          model: " gpt-5-mini ",
          updatedAt: 10,
          entry: {
            id: "ignored-wire-id",
            description: "GPT-5 mini",
            metadata: {
              supports_tools: true,
            },
            supplemental: {
              source: "models.dev",
              description: "Community name",
              metadata: {
                context_window: 1_000_000,
              },
            },
          },
        },
        {
          provider: "openai",
          model: "gpt-5-mini",
          updatedAt: 5,
          entry: {
            description: "Older name",
          },
        },
        {
          provider: "",
          model: "broken",
          entry: {},
        },
      ],
    });

    expect(summaries).toEqual([
      {
        provider: "openai",
        model: "gpt-5-mini",
        updatedAt: 10,
        entry: {
          id: "gpt-5-mini",
          description: "GPT-5 mini",
          metadata: {
            supports_tools: true,
          },
          supplemental: {
            source: "models.dev",
            description: "Community name",
            metadata: {
              context_window: 1_000_000,
            },
          },
        },
      },
    ]);
    expect(
      findHermesSelectedModelSummary(summaries, "openai", "gpt-5-mini")?.entry
        .description,
    ).toBe("GPT-5 mini");
  });

  it("separates virtual providers and reports their service dependencies", () => {
    const virtualCatalog: HermesModelCatalogResponse = {
      ...catalog,
      providers: {
        ...catalog.providers,
        moa: {
          source: "virtual",
          auth_type: "virtual",
          authenticated: true,
          models: [{ id: "review" }],
        },
      },
      provider_ids: [...(catalog.provider_ids ?? []), "moa"],
      authenticated_provider_ids: [
        ...(catalog.authenticated_provider_ids ?? []),
        "moa",
      ],
      canonical_providers: [
        ...(catalog.canonical_providers ?? []),
        {
          slug: "moa",
          label: "Mixture of Agents",
          tui_desc: "Mixture of Agents",
        },
      ],
    };
    const providers = buildHermesModelProviderViews(
      virtualCatalog,
      { provider: "configured", model: "configured-a" },
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );
    const moa = {
      ok: true,
      configured: true,
      default_preset: "review",
      active_preset: "",
      presets: {
        review: {
          reference_models: [
            { provider: "configured", model: "configured-a" },
            { provider: "ambient", model: "ambient-a" },
          ],
          aggregator: {
            provider: "configured",
            model: "configured-b",
          },
          reference_temperature: 0.6,
          aggregator_temperature: 0.4,
          max_tokens: 4096,
          enabled: true,
        },
      },
      reference_models: [],
      aggregator: { provider: "", model: "" },
      reference_temperature: 0.6,
      aggregator_temperature: 0.4,
      max_tokens: 4096,
      enabled: true,
    };

    expect(providers.find((provider) => provider.id === "moa")?.kind).toBe(
      "virtual",
    );
    expect(buildHermesModelPickerGroups(providers)).not.toContainEqual(
      expect.objectContaining({ provider: "moa" }),
    );

    const capabilities = buildHermesVirtualCapabilityViews(providers, moa);
    expect(capabilities[0]?.presets[0]?.status).toBe("degraded");
    expect(capabilities[0]?.presets[0]?.dependencies).toEqual([
      expect.objectContaining({ role: "reference", status: "ready" }),
      expect.objectContaining({
        role: "reference",
        status: "provider-hidden",
      }),
      expect.objectContaining({ role: "aggregator", status: "ready" }),
    ]);
    expect(buildHermesVirtualCapabilityPickerGroups(capabilities)).toEqual([
      {
        capability: "moa",
        provider: "moa",
        label: "Mixture of Agents",
        models: [{ id: "review" }],
      },
    ]);

    const providersWithHiddenAggregator = providers.map((provider) =>
      provider.id === "configured"
        ? {
            ...provider,
            models: provider.models.map((model) =>
              model.id === "configured-b"
                ? { ...model, visible: false }
                : model,
            ),
          }
        : provider,
    );
    const unavailableCapabilities = buildHermesVirtualCapabilityViews(
      providersWithHiddenAggregator,
      moa,
    );
    expect(unavailableCapabilities[0]?.presets[0]?.status).toBe("unavailable");
    expect(
      unavailableCapabilities[0]?.presets[0]?.dependencies.at(-1)?.status,
    ).toBe("model-hidden");
    expect(
      buildHermesVirtualCapabilityPickerGroups(unavailableCapabilities),
    ).toEqual([]);
  });

  it("marks MoA unavailable when its aggregator provider is unavailable", () => {
    const virtualCatalog: HermesModelCatalogResponse = {
      ok: true,
      providers: {
        configured: {
          models: [{ id: "reference" }],
        },
        moa: {
          source: "virtual",
          auth_type: "virtual",
          models: [{ id: "default" }],
        },
      },
      provider_ids: ["configured", "moa"],
      config_provider_ids: ["configured"],
      authenticated_provider_ids: ["configured", "moa"],
      canonical_providers: [
        { slug: "configured", label: "Configured", tui_desc: "Configured" },
        {
          slug: "moa",
          label: "Mixture of Agents",
          tui_desc: "Mixture of Agents",
        },
      ],
    };
    const providers = buildHermesModelProviderViews(
      virtualCatalog,
      {},
      DEFAULT_HERMES_MODEL_DISPLAY_PREFERENCES,
    );
    const capabilities = buildHermesVirtualCapabilityViews(providers, {
      ok: true,
      configured: false,
      default_preset: "default",
      active_preset: "",
      presets: {
        default: {
          enabled: true,
          reference_models: [{ provider: "configured", model: "reference" }],
          aggregator: { provider: "missing", model: "aggregator" },
          reference_temperature: 0.6,
          aggregator_temperature: 0.4,
          max_tokens: 4096,
        },
      },
      reference_models: [],
      aggregator: { provider: "", model: "" },
      reference_temperature: 0.6,
      aggregator_temperature: 0.4,
      max_tokens: 4096,
      enabled: true,
    });

    expect(capabilities[0]?.presets[0]?.status).toBe("unavailable");
    expect(capabilities[0]?.presets[0]?.dependencies.at(-1)?.status).toBe(
      "provider-unavailable",
    );
    expect(buildHermesVirtualCapabilityPickerGroups(capabilities)).toEqual([]);
  });
});
