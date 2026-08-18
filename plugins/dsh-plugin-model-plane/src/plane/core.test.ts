import { describe, expect, it, vi } from "vitest";

import {
  ModelPlaneService,
  applyModelProviderCapabilities,
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

  it("discovers models independently and preserves driver capabilities", () => {
    const provider = builtInModelProviders()[0]!;
    expect(modelDiscoveryUrl(provider).href).toBe(
      "https://api.deepseek.com/models",
    );
    const enriched = applyModelProviderCapabilities({
      ...provider,
      models: discoveredModels(
        { data: [{ id: "deepseek-v4-pro", name: "V4 Pro" }] },
        provider.models,
      ),
    });
    expect(enriched.models[0]?.name).toBe("V4 Pro");
    expect(
      enriched.models[0]?.reasoning?.efforts.map((effort) => effort.id),
    ).toEqual(["off", "high", "max"]);
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
