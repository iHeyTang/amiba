import { describe, expect, it, vi } from "vitest";

import {
  ModelPlaneService,
  builtInModelProviders,
  defaultSelectionOf,
  discoveredModels,
  groupsOf,
  modelDiscoveryUrl,
  normalizeModels,
  normalizeRegistry,
} from "./index.js";

describe("harness-independent Model Plane", () => {
  it("keeps reasoning effort as one model capability with optional wire spelling", () => {
    const models = normalizeModels([
      {
        id: "reasoner",
        name: "Reasoner",
        reasoning: {
          defaultEffort: "high",
          efforts: [
            { id: "off", name: "Off", wireValue: null },
            { id: "high", name: "High", wireValue: "high" },
          ],
        },
      },
    ]);
    expect(models).toHaveLength(1);
    expect(models[0]?.reasoning).toEqual({
      defaultEffort: "high",
      efforts: [
        { id: "off", name: "Off", wireValue: null },
        { id: "high", name: "High", wireValue: "high" },
      ],
    });
  });

  it("normalizes providers without retaining harness-specific fields", () => {
    const registry = normalizeRegistry({
      version: 1,
      revision: 7,
      providers: [
        {
          id: "vendor-a",
          displayName: "Vendor A",
          protocol: "openai-completions",
          enabled: true,
          editable: true,
          source: "user",
          models: [{ id: "a-1", name: "A 1" }],
          dshProjection: { settingsNs: "llm-pi-ai" },
        },
      ],
      projectionFailures: [],
    });
    expect(registry?.revision).toBe(7);
    expect(registry?.providers[0]).not.toHaveProperty("dshProjection");
    expect(groupsOf(registry!.providers)).toEqual([
      {
        id: "vendor-a",
        name: "Vendor A",
        models: [{ id: "a-1", name: "A 1" }],
      },
    ]);
  });

  it("excludes disabled models and keeps the product default", () => {
    const registry = normalizeRegistry({
      version: 1,
      revision: 2,
      providers: [
        {
          id: "vendor-a",
          displayName: "Vendor A",
          protocol: "openai-responses",
          enabled: true,
          editable: true,
          source: "user",
          models: [
            { id: "hidden", name: "Hidden", enabled: false },
            { id: "reasoner", name: "Reasoner" },
          ],
        },
      ],
      defaultSelection: { provider: "vendor-a", model: "reasoner" },
      projectionFailures: [],
    });
    expect(groupsOf(registry!.providers)[0]?.models).toEqual([
      registry!.providers[0]!.models[1],
    ]);
    expect(defaultSelectionOf(registry!)).toEqual({
      provider: "vendor-a",
      model: "reasoner",
    });
  });

  it("seeds the built-in provider with identity only, never capabilities", () => {
    const provider = builtInModelProviders()[0]!;
    expect(modelDiscoveryUrl(provider).href).toBe(
      "https://api.deepseek.com/models",
    );
    // The driver knows how to REACH DeepSeek, not what its models can do.
    // DSH's own adapter ships this same list with its own defaults and
    // `resolveModelInfo` is the authority at request time; a second, guessed
    // copy here is what put a fabricated `["text"]` and a fabricated reasoning
    // ladder onto models nobody had ever seen.
    for (const model of provider.models) {
      expect(model.inputModalities).toBeUndefined();
      expect(model.reasoning).toBeUndefined();
      expect(model.contextWindow).toBeUndefined();
      expect(model.maxTokens).toBeUndefined();
    }
  });

  it("takes model capabilities from the provider's own discovery response", () => {
    const provider = builtInModelProviders()[0]!;
    const models = discoveredModels(
      {
        data: [
          {
            id: "deepseek-v4-flash-vision-exp",
            name: "V4 Flash Vision",
            context_window: 128_000,
            max_output_tokens: 8_000,
            input_modalities: ["text", "image"],
          },
        ],
      },
      provider.models,
    );
    const discovered = models.find(
      (model) => model.id === "deepseek-v4-flash-vision-exp",
    );
    expect(discovered?.name).toBe("V4 Flash Vision");
    expect(discovered?.contextWindow).toBe(128_000);
    expect(discovered?.maxTokens).toBe(8_000);
    expect(discovered?.inputModalities).toEqual(["text", "image"]);
  });

  it("leaves a model the provider says nothing about carrying no claims", () => {
    const models = discoveredModels({ data: [{ id: "deepseek-future" }] }, []);
    const discovered = models.find((model) => model.id === "deepseek-future");
    expect(discovered).toBeDefined();
    expect(discovered?.inputModalities).toBeUndefined();
    expect(discovered?.reasoning).toBeUndefined();
    expect(discovered?.contextWindow).toBeUndefined();
  });

  it("lets a fresh discovery answer overwrite a stale stored modality", () => {
    const stored = [
      {
        id: "deepseek-v4-flash-vision-exp",
        name: "vision",
        inputModalities: ["text"],
      },
    ];
    const models = discoveredModels(
      {
        data: [
          {
            id: "deepseek-v4-flash-vision-exp",
            input_modalities: ["text", "image"],
          },
        ],
      },
      stored,
    );
    expect(models[0]?.inputModalities).toEqual(["text", "image"]);
  });

  it("runs without a harness and invokes a projection only at its port", async () => {
    const state: Record<string, unknown> = {};
    const projection = {
      project: vi.fn(),
      remove: vi.fn(),
      unsetCredential: vi.fn(),
    };
    const service = new ModelPlaneService({
      store: {
        async get(key) {
          return { [key]: state[key] };
        },
        async set(patch) {
          Object.assign(state, patch);
        },
      },
      vault: {
        async describe() {
          return {};
        },
        async resolve() {
          return undefined;
        },
        async set() {},
        async unset() {},
      },
      projection,
      builtIns: () => [],
    });
    const initial = await service.snapshot();
    await service.upsert({
      expectedRevision: initial.revision,
      provider: {
        id: "vendor-a",
        displayName: "Vendor A",
        protocol: "openai-completions",
        enabled: true,
        editable: true,
        source: "user",
        models: [{ id: "model-a", name: "Model A" }],
      },
    });
    expect(projection.project).toHaveBeenCalledTimes(1);
    await service.prepareProjection("vendor-a");
    expect(projection.project).toHaveBeenCalledTimes(2);
  });
});
