import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  return {
    values,
    storageGet: vi.fn(async (keys?: string | string[]) => {
      const requested =
        typeof keys === "string" ? [keys] : (keys ?? Object.keys(values));
      return Object.fromEntries(
        requested
          .filter((key) => Object.prototype.hasOwnProperty.call(values, key))
          .map((key) => [key, values[key]]),
      );
    }),
    storageSet: vi.fn(async (patch: Record<string, unknown>) => {
      Object.assign(values, patch);
    }),
    getMain: vi.fn(async () => ({
      ok: true,
      provider: "openai",
      model: "gpt-5-mini",
      effective_context_length: 1_000_000,
      capabilities: {
        supports_reasoning: true,
        supports_tools: true,
      },
    })),
    getAuxiliary: vi.fn(async () => ({
      ok: true,
      tasks: [],
    })),
    getMoa: vi.fn(async () => ({
      ok: true,
      default_preset: "",
      active_preset: "",
      presets: {},
      reference_models: [],
      aggregator: { provider: "", model: "" },
      reference_temperature: null,
      aggregator_temperature: null,
      max_tokens: 4096,
      enabled: false,
    })),
    getCatalog: vi.fn(async () => ({
      ok: true,
      provider_ids: ["openai"],
      config_provider_ids: ["openai"],
      authenticated_provider_ids: ["openai"],
      canonical_providers: [
        {
          slug: "openai",
          label: "OpenAI",
          tui_desc: "OpenAI",
        },
      ],
      providers: {
        openai: {
          authenticated: true,
          models: [
            {
              id: "gpt-5-mini",
              description: "GPT-5 mini",
              supplemental: {
                source: "models.dev",
                description: "Community fallback",
                metadata: {
                  context_window: 2_000_000,
                },
              },
            },
          ],
        },
      },
    })),
  };
});

vi.mock("@amiba/platform", () => ({
  getPlatform: () => ({
    storage: {
      get: mocks.storageGet,
      set: mocks.storageSet,
      remove: vi.fn(),
      watch: vi.fn(() => () => undefined),
    },
  }),
}));

vi.mock("../hermes-agent-model", () => ({
  getHermesAuxiliaryModels: mocks.getAuxiliary,
  getHermesMainModelInfo: mocks.getMain,
  getHermesMoaConfig: mocks.getMoa,
  getHermesModelCatalog: mocks.getCatalog,
  getHermesProviderCredentials: vi.fn(),
  getHermesProviderModels: vi.fn(),
  saveHermesProviderCredentials: vi.fn(),
  saveHermesMoaConfig: vi.fn(),
  setHermesAgentMainModel: vi.fn(),
  setHermesAuxiliarySlot: vi.fn(),
}));

import {
  HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY,
  hermesModelGateway,
} from "../hermes-model-gateway";

describe("Hermes selected-model summary cache", () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.values)) delete mocks.values[key];
    vi.clearAllMocks();
  });

  it("remembers descriptive model data after a trusted catalog load", async () => {
    await hermesModelGateway.workspace.readConfiguration();
    await hermesModelGateway.catalog.read(false);

    await vi.waitFor(() => {
      expect(mocks.storageSet).toHaveBeenCalled();
    });

    const stored = mocks.values[
      HERMES_SELECTED_MODEL_SUMMARIES_STORAGE_KEY
    ] as {
      items: Array<{
        provider: string;
        model: string;
        entry: {
          description?: string;
          metadata?: Record<string, unknown>;
          supplemental?: {
            source: string;
            metadata: Record<string, unknown>;
          };
        };
      }>;
    };
    expect(stored.items[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5-mini",
      entry: {
        description: "GPT-5 mini",
        metadata: {
          context_window: 1_000_000,
          supports_reasoning: true,
          supports_tools: true,
        },
        supplemental: {
          source: "models.dev",
          metadata: {
            context_window: 2_000_000,
          },
        },
      },
    });

    expect(await hermesModelGateway.picker.readCurrent()).toMatchObject({
      ok: true,
      current: {
        provider: "openai",
        model: "gpt-5-mini",
      },
      summary: {
        entry: {
          description: "GPT-5 mini",
        },
      },
    });
  });
});
