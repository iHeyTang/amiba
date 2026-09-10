import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import { migrateLegacySettings } from "./migrate-legacy.js";
function fixture(legacy?: unknown, existing?: unknown) {
  const values: Record<string, unknown> = { "modelPlane.registry.v1": legacy };
  const descriptor = { ns: "llm-pi-ai", revision: 3, base: {}, user: existing };
  const settings = {
    describe: () => [descriptor],
    mutate: vi.fn(async () => {}),
  };
  const store = {
    get: async (key: string) => ({ [key]: values[key] }),
    set: async (patch: Record<string, unknown>) => {
      Object.assign(values, patch);
    },
  };
  return { ctx: { settings } as unknown as Context, store, values, settings };
}
const legacy = {
  version: 1,
  revision: 1,
  providers: [
    {
      id: "community",
      displayName: "Community",
      protocol: "openai-responses",
      enabled: false,
      editable: true,
      source: "user",
      models: [{ id: "m", name: "M" }],
    },
  ],
  projectionFailures: [],
};
describe("one-time upgrade to official settings", () => {
  it("never seeds a private registry or official providers for a fresh installation", async () => {
    const { ctx, store, values, settings } = fixture();
    await migrateLegacySettings(ctx, store);
    expect(settings.mutate).not.toHaveBeenCalled();
    expect(values["modelPlane.registry.v1"]).toBeUndefined();
  });
  it("migrates missing legacy routes once and preserves display preferences", async () => {
    const { ctx, store, settings } = fixture(legacy);
    const prefs = await migrateLegacySettings(ctx, store);
    await migrateLegacySettings(ctx, store);
    expect(prefs.hiddenProviders).toEqual(["community"]);
    expect(settings.mutate).toHaveBeenCalledTimes(1);
    expect(settings.mutate).toHaveBeenCalledWith(
      "llm-pi-ai",
      [
        expect.objectContaining({
          op: "set",
          path: ["providers", "community"],
          value: expect.objectContaining({ api: "openai-responses" }),
        }),
      ],
      3,
    );
  });
  it("does not overwrite official configuration already owned by a plugin", async () => {
    const { ctx, store, settings } = fixture(legacy, {
      providers: { community: { api: "future-native-api" } },
    });
    await migrateLegacySettings(ctx, store);
    expect(settings.mutate).not.toHaveBeenCalled();
  });
});
