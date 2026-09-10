import { describe, expect, it } from "vitest";

import {
  defaultSelectionOf,
  groupsOf,
  normalizeModels,
  normalizeRegistry,
} from "./core.js";

describe("legacy registry migration decoding", () => {
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

});
