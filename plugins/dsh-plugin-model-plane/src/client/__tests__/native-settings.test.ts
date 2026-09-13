import { describe, expect, it, vi } from "vitest";
import type {
  IApiClient,
  ConfigurableProviderView,
  SettingsNamespaceView,
} from "@deepseek-ai/dsh-api-remotes/client";
import z from "@deepseek-ai/schemastery";
import { NativeProviderSettings, UI_NS } from "../native-settings.js";

const ok = <T>(value: T) => ({ result: { ok: true as const, value } });
function fixture() {
  const namespace: SettingsNamespaceView = {
    ns: "community-plugin",
    revision: 4,
    applies: "live",
    secrets: [],
    schema: z
      .object({ token: z.string().role("credential-ref"), region: z.string() })
      .toJSON(),
    value: { token: "COMMUNITY_KEY", region: "east" },
  };
  const preferences: SettingsNamespaceView = {
    ns: UI_NS,
    schema: {},
    value: {},
    revision: 1,
    applies: "live",
    secrets: [],
  };
  const namespaces = [
    namespace,
    preferences,
    {
      ns: "agent-default-model",
      schema: {},
      value: {},
      revision: 2,
      applies: "live",
      secrets: [],
    },
  ];
  const provider: ConfigurableProviderView = {
    provider: "community",
    displayName: "Community",
    settingsNs: namespace.ns,
    settingsPath: [],
    active: true,
  };
  const group = {
    id: "community",
    name: "Community",
    models: [
      {
        id: "model",
        name: "Model",
        reasoning: { efforts: [{ id: "custom-effort", name: "Careful" }] },
      },
    ],
  };
  const api = {
    llm: {
      providers: vi.fn(async () => ok({ providers: [provider] })),
      models: vi.fn(async () => ok({ groups: [group], failures: [] })),
      discoverModels: vi.fn(async () => ok({ models: [{ id: "new" }] })),
    },
    settings: {
      describe: vi.fn(async () =>
        ok({ namespaces, writable: true, hasDocument: true }),
      ),
      mutate: vi.fn(
        async (request: {
          ns: string;
          ops: Array<{ op: string; path: string[]; value?: unknown }>;
          expectedRevision: number;
        }) => {
          const n = namespaces.find((n) => n.ns === request.ns)!;
          if (request.expectedRevision !== n.revision)
            return {
              result: { ok: false as const, error: { message: "stale" } },
            };
          for (const op of request.ops) {
            let value = n.value as Record<string, unknown>;
            for (const part of op.path.slice(0, -1))
              value = (value[part] ??= {}) as Record<string, unknown>;
            const key = op.path.at(-1)!;
            if (op.op === "unset") delete value[key];
            else value[key] = op.value;
          }
          n.revision++;
          return ok(n);
        },
      ),
    },
    credentials: {
      describe: vi.fn(async () =>
        ok({
          credentials: { COMMUNITY_KEY: { configured: true, writable: true } },
        }),
      ),
      set: vi.fn(async () => ok({})),
      unset: vi.fn(async () => ok({})),
    },
  };
  const controller = new NativeProviderSettings(
    api as unknown as IApiClient,
    () => () => {},
  );
  return {
    api,
    controller,
    namespace,
    namespaces,
    provider,
    group,
    preferences,
  };
}
describe("Amiba UI uses native DSH APIs", () => {
  it("renders official ABC without any Amiba-specific declaration from a community plugin", async () => {
    const { controller, api, provider, group, namespaces } = fixture();
    namespaces.splice(1, 1); // Optional D preference namespace is absent.
    const view = await controller.snapshot();
    expect(api.llm.providers).toHaveBeenCalledWith({});
    expect(api.llm.models).toHaveBeenCalledWith({});
    expect(view.groups).toEqual([group]);
    expect(view.providers[0].official).toBe(provider);
    expect(view.providers[0].configuration).toMatchObject({
      namespace: "community-plugin",
      credentialFields: [{ path: ["token"], ref: "COMMUNITY_KEY" }],
    });
    expect(api.settings.mutate).not.toHaveBeenCalled();
    expect(view.providers[0].source).toBe("imported"); // Absent declared is unknown.
  });
  it("writes the plugin's native namespace with its revision and official credential calls", async () => {
    const { controller, api } = fixture();
    await controller.configure("community", {
      expectedRevision: 4,
      ops: [{ op: "set", path: ["region"], value: "west" }],
      credentials: [{ ref: "COMMUNITY_KEY", value: "test-key" }],
    });
    expect(api.settings.mutate).toHaveBeenCalledWith({
      ns: "community-plugin",
      expectedRevision: 4,
      ops: [{ op: "set", path: ["region"], value: "west" }],
    });
    expect(api.credentials.set).toHaveBeenCalledWith({
      ref: "COMMUNITY_KEY",
      value: "test-key",
    });
  });
  it("rejects stale editors and undeclared credentials", async () => {
    const { controller, api } = fixture();
    await expect(
      controller.configure("community", {
        expectedRevision: 3,
        ops: [],
        credentials: [],
      }),
    ).rejects.toThrow("Settings changed");
    await expect(
      controller.configure("community", {
        expectedRevision: 4,
        ops: [],
        credentials: [{ ref: "OTHER_KEY", value: "x" }],
      }),
    ).rejects.toThrow("not declared");
    expect(api.credentials.set).not.toHaveBeenCalled();
    expect(api.settings.mutate).not.toHaveBeenCalled();
  });
  it("keeps D display preferences independent of official ABC model truth", async () => {
    const { controller, api, group } = fixture();
    const before = await controller.snapshot();
    const after = await controller.upsert({
      provider: { ...before.providers[0], enabled: false },
      expectedRevision: before.revision,
    });
    expect(after.groups).toEqual([]);
    expect(
      api.settings.mutate.mock.calls.every(([request]) => request.ns === UI_NS),
    ).toBe(true);
    expect((await api.llm.models()).result.value.groups).toEqual([group]);
  });
  it("uses official defaults with opaque adapter reasoning IDs", async () => {
    const { controller, api } = fixture();
    await controller.setDefaultSelection({
      provider: "community",
      model: "model",
      reasoningEffort: "custom-effort",
    });
    expect(api.settings.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        ns: "agent-default-model",
        expectedRevision: 2,
        ops: expect.arrayContaining([
          { op: "set", path: ["reasoningEffort"], value: "custom-effort" },
        ]),
      }),
    );
  });
  it("invokes discovery using the plugin's official namespace without inventing a protocol", async () => {
    const { controller, api } = fixture();
    const view = await controller.snapshot();
    await controller.discover({ provider: view.providers[0] });
    expect(api.llm.discoverModels).toHaveBeenCalledWith({
      settingsNs: "community-plugin",
      provider: "community",
    });
  });
  it("reflects official plugin unload without private registry entries", async () => {
    const { controller, api } = fixture();
    await controller.snapshot();
    api.llm.providers.mockResolvedValue(ok({ providers: [] }));
    api.llm.models.mockResolvedValue(ok({ groups: [], failures: [] }));
    const view = await controller.snapshot();
    expect(view.providers).toEqual([]);
    expect(view.groups).toEqual([]);
  });
  it("retains ABC models for a provider with no editable settings", async () => {
    const { controller, provider } = fixture();
    provider.settingsNs = "";
    const view = await controller.snapshot();
    expect(view.groups[0].models).toHaveLength(1);
    expect(view.providers[0].editable).toBe(false);
  });
  it("keeps an advertised but unconfigured provider off and out of model menus", async () => {
    const { controller, provider } = fixture();
    provider.active = false;
    const view = await controller.snapshot();
    expect(view.providers[0]).toMatchObject({
      enabled: false,
      availability: "unconfigured",
    });
    expect(view.groups).toEqual([]);
  });
  it("retains the catalog but excludes models and defaults when a required key is missing", async () => {
    const { controller, api, namespaces } = fixture();
    namespaces[2].value = { provider: "community", model: "model" };
    api.credentials.describe.mockResolvedValue(
      ok({
        credentials: { COMMUNITY_KEY: { configured: false, writable: true } },
      }),
    );
    const view = await controller.snapshot();
    expect(view.providers[0]).toMatchObject({
      enabled: false,
      availability: "missing-credential",
    });
    expect(view.providers[0].models).toHaveLength(1);
    expect(view.groups).toEqual([]);
    expect(view.defaultSelection).toBeUndefined();
    await expect(
      controller.upsert({ provider: { ...view.providers[0], enabled: true } }),
    ).rejects.toThrow("required credentials");
    expect(api.settings.mutate).not.toHaveBeenCalled();
  });
  it("recomputes availability when credentials are saved or removed, preserving a user's off preference", async () => {
    const { controller, api } = fixture();
    const before = await controller.snapshot();
    await controller.upsert({
      provider: { ...before.providers[0], enabled: false },
    });
    api.credentials.describe.mockResolvedValue(
      ok({
        credentials: { COMMUNITY_KEY: { configured: false, writable: true } },
      }),
    );
    expect((await controller.snapshot()).groups).toEqual([]);
    api.credentials.describe.mockResolvedValue(
      ok({
        credentials: { COMMUNITY_KEY: { configured: true, writable: true } },
      }),
    );
    const ready = await controller.snapshot();
    expect(ready.providers[0]).toMatchObject({
      availability: "ready",
      enabled: false,
    });
    const enabled = await controller.upsert({
      provider: { ...ready.providers[0], enabled: true },
    });
    expect(enabled.groups).toHaveLength(1);
    api.credentials.describe.mockResolvedValue(
      ok({
        credentials: { COMMUNITY_KEY: { configured: false, writable: true } },
      }),
    );
    expect((await controller.snapshot()).groups).toEqual([]);
  });
  it("allows active local or provider-owned auth routes with no declared key requirement", async () => {
    const { controller, namespace } = fixture();
    namespace.value = { region: "local" };
    const view = await controller.snapshot();
    expect(view.providers[0]).toMatchObject({
      availability: "ready",
      enabled: true,
    });
    expect(view.groups).toHaveLength(1);
  });
});

describe("official provider-card state", () => {
  it("retains the actual directory row and separates native auth from the card API-key fact", async () => {
    const f = fixture();
    const value = await f.controller.snapshot();
    const profile = value.providers[0]!;
    expect(profile.providerCard?.provider).toBe(f.provider);
    expect(profile.providerCard).toMatchObject({ configured: true, keyConfigured: false });
    expect(profile.availability).toBe("ready");
    expect(f.api.credentials.describe).toHaveBeenCalledWith({ refs: ["COMMUNITY_KEY", "COMMUNITY_API_KEY"] });
  });
  it("joins dormant rows with their confirmed derived credential and updates after configuration", async () => {
    const f = fixture();
    f.provider.settingsPath = ["profiles", "custom"];
    f.api.credentials.describe.mockResolvedValue(ok({
      credentials: { COMMUNITY_API_KEY: { configured: true, writable: true } },
    }) as never);
    let value = await f.controller.snapshot();
    expect(value.providers[0]?.providerCard).toMatchObject({ configured: false, keyConfigured: true });
    f.namespace.value = { profiles: { custom: { apiKeyEnv: "NAMED_KEY" } } };
    value = await f.controller.snapshot();
    expect(value.providers[0]?.providerCard).toMatchObject({ configured: true, keyConfigured: false });
    expect(f.api.credentials.describe).toHaveBeenLastCalledWith({ refs: ["NAMED_KEY"] });
    f.api.credentials.describe.mockResolvedValue(ok({
      credentials: { NAMED_KEY: { configured: true, writable: true } },
    }) as never);
    value = await f.controller.snapshot();
    expect(value.providers[0]?.providerCard).toMatchObject({ configured: true, keyConfigured: true });
  });
});
