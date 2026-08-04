import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import {
  getHermesAuxiliaryModels,
  getHermesMainModelInfo,
  getHermesMoaConfig,
  getHermesModelCatalog,
  getHermesProviderCredentials,
  saveHermesProviderCredentials,
  saveHermesMoaConfig,
  setHermesAgentMainModel,
} from "../hermes-agent-model";

describe("Hermes model catalog client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
  });

  it("preserves the providers Hermes can currently authenticate", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        providers: [
          {
            slug: "oauth-provider",
            name: "OAuth Provider",
            authenticated: true,
            models: ["model-a", "model-b"],
          },
          {
            slug: "unconfigured-provider",
            name: "Unavailable Provider",
            authenticated: false,
            models: ["model-c"],
          },
        ],
        configured_provider_slugs: [],
        dotenv_configured_provider_slugs: [],
      }),
    );

    const result = await getHermesModelCatalog();

    expect(result.authenticated_provider_ids).toEqual(["oauth-provider"]);
    expect(result.providers?.["oauth-provider"]?.models).toEqual([
      { id: "model-a" },
      { id: "model-b" },
    ]);
  });

  it("preserves Hermes provider classification metadata", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        providers: [
          {
            slug: "moa",
            name: "Mixture of Agents",
            source: "virtual",
            auth_type: "virtual",
            authenticated: true,
            warning: "Aggregator acts after references.",
            models: ["default"],
          },
        ],
      }),
    );

    const result = await getHermesModelCatalog();

    expect(result.providers?.moa).toMatchObject({
      source: "virtual",
      auth_type: "virtual",
      authenticated: true,
      warning: "Aggregator acts after references.",
    });
  });

  it("routes model reads and writes to the selected Hermes profile", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    );

    await getHermesMainModelInfo("research & review");
    await setHermesAgentMainModel(
      { provider: "anthropic", model: "claude-sonnet" },
      "research & review",
    );

    expect(backplaneFetch).toHaveBeenNthCalledWith(
      1,
      "/hermes/model/info?profile=research%20%26%20review",
      { method: "GET" },
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      2,
      "/hermes/model/set?profile=research%20%26%20review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scope: "main",
          provider: "anthropic",
          model: "claude-sonnet",
        }),
      }),
    );
  });

  it("scopes auxiliary and credential operations to the selected profile", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        provider: "deepseek",
        fields: [],
        auth_hint: "",
        tasks: [],
      }),
    );

    await getHermesAuxiliaryModels("researcher");
    await getHermesProviderCredentials("deepseek", false, "researcher");
    await saveHermesProviderCredentials(
      "deepseek",
      { DEEPSEEK_API_KEY: "secret" },
      "researcher",
    );

    expect(backplaneFetch).toHaveBeenNthCalledWith(
      1,
      "/hermes/model/auxiliary?profile=researcher",
      { method: "GET" },
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      2,
      "/hermes/provider-credentials?provider=deepseek&profile=researcher",
      { method: "GET" },
    );
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      3,
      "/hermes/provider-credentials?profile=researcher",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          provider: "deepseek",
          values: { DEEPSEEK_API_KEY: "secret" },
        }),
      }),
    );
  });

  it("reads and writes MoA through the dedicated Hermes surface", async () => {
    const payload = {
      default_preset: "default",
      active_preset: "",
      presets: {
        default: {
          enabled: true,
          reference_models: [{ provider: "openai", model: "reference" }],
          aggregator: { provider: "openai", model: "aggregator" },
          reference_temperature: 0.6,
          aggregator_temperature: 0.4,
          reference_timeout: 120,
          degraded_reference_policy: "silent" as const,
          max_tokens: 4096,
          reference_max_tokens: 800,
          fanout: "every_n:3" as const,
        },
      },
      reference_models: [],
      aggregator: { provider: "", model: "" },
      reference_temperature: 0.6,
      aggregator_temperature: 0.4,
      max_tokens: 4096,
      enabled: true,
      privacy_filter: "display" as const,
    };
    backplaneFetch.mockResolvedValue(Response.json(payload));

    expect((await getHermesMoaConfig()).ok).toBe(true);
    await saveHermesMoaConfig(payload);

    expect(backplaneFetch).toHaveBeenLastCalledWith("/hermes/model/moa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        default_preset: "default",
        active_preset: "",
        presets: payload.presets,
        privacy_filter: "display",
      }),
    });
  });
});
