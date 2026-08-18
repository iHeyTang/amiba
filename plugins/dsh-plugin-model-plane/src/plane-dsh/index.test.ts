import { describe, expect, it } from "vitest";

import {
  apiForDshProvider,
  bindingForDshProvider,
  piAiModelRows,
} from "./index";

describe("Model Plane DSH adapter", () => {
  it("maps a custom provider without moving DSH fields into Model Plane", () => {
    const provider = {
      id: "vendor-a",
      displayName: "Vendor A",
      protocol: "openai-responses" as const,
      enabled: true,
      editable: true,
      source: "user" as const,
      models: [],
    };
    expect(bindingForDshProvider(provider)).toEqual({
      settingsNs: "llm-pi-ai",
      settingsPath: ["providers", "vendor-a"],
    });
    expect(apiForDshProvider(provider)).toBe("openai-responses");
  });

  it("projects model-local reasoning levels as capability metadata", () => {
    expect(
      piAiModelRows([
        {
          id: "reasoner",
          name: "Reasoner",
          inputModalities: ["text", "image"],
          reasoning: {
            defaultEffort: "high",
            efforts: [
              { id: "off", name: "Off", wireValue: null },
              { id: "high", name: "High", wireValue: "high" },
              { id: "max", name: "Max", wireValue: "max" },
            ],
          },
        },
      ]),
    ).toEqual([
      {
        id: "reasoner",
        name: "Reasoner",
        input: ["text", "image"],
        reasoningEfforts: { off: null, high: "high", max: "max" },
      },
    ]);
  });

  it("fails an unsupported harness projection without rejecting canonical storage", () => {
    expect(() =>
      apiForDshProvider({
        id: "native-only",
        displayName: "Native only",
        protocol: "provider-native",
        enabled: true,
        editable: true,
        source: "user",
        models: [],
      }),
    ).toThrow("no execution adapter");
    expect(() =>
      piAiModelRows([
        {
          id: "future",
          name: "Future",
          reasoning: { efforts: [{ id: "ultra", name: "Ultra" }] },
        },
      ]),
    ).toThrow("cannot project reasoning effort ultra");
  });
});
