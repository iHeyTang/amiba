/** One-way upgrade of old installations. Never used by provider registration or UI requests. */
import type { Context } from "@deepseek-ai/cordis";
import {
  type SettingsPathOp,
} from "@deepseek-ai/dsh-settings";
import type { ModelPlaneStore } from "./store.js";
import { asObject, normalizeRegistry } from "./plane/core.js";
import { deepSeekModelRows, piAiModelRows } from "./plane-dsh/index.js";
const PREFS = "officialModelUi.v1";
const at = (value: unknown, path: readonly string[]): unknown =>
  path.reduce((v, key) => asObject(v)[key], value);
export async function migrateLegacySettings(
  ctx: Context,
  store: ModelPlaneStore,
): Promise<Record<string, unknown>> {
  const prefs = asObject((await store.get(PREFS))[PREFS]);
  if (prefs.migrated) return prefs;
  const legacy = normalizeRegistry(
    (await store.get("modelPlane.registry.v1"))["modelPlane.registry.v1"],
  );
  if (legacy) {
    const migrationFailures: Array<{
      id: string;
      name: string;
      message: string;
    }> = [];
    prefs.migrationFailures = migrationFailures;
    for (const provider of legacy.providers) {
      try {
        // Previous versions already projected these routes. Never overwrite a
        // namespace/profile which official settings already owns.
        const ns =
          provider.id === "deepseek-official" ? "llm-deepseek" : "llm-pi-ai";
        const descriptor = ctx.settings
          .describe({ redactSecrets: true })
          .find((d) => String(d.ns) === ns);
        if (!descriptor) continue;
        const path =
          provider.id === "deepseek-official" ? [] : ["providers", provider.id];
        if (
          at(descriptor.user, path) !== undefined ||
          (path.length && at(descriptor.base, path) !== undefined)
        )
          continue;
        const value = {
          ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
          ...(provider.credentialRef
            ? { apiKeyEnv: provider.credentialRef }
            : {}),
          ...(path.length
            ? {
                displayName: provider.displayName,
                api:
                  provider.protocol === "deepseek-chat-completions"
                    ? "openai-completions"
                    : provider.protocol,
              }
            : {}),
          models: path.length
            ? piAiModelRows(provider.models)
            : deepSeekModelRows(provider.models),
        };
        const ops: SettingsPathOp[] = path.length
          ? [{ op: "set", path, value }]
          : Object.entries(value).map(([key, v]) => ({
              op: "set",
              path: [key],
              value: v,
            }));
        await ctx.settings.mutate(
          ns,
          ops,
          descriptor.revision,
        );
      } catch (error) {
        migrationFailures.push({
          id: provider.id,
          name: provider.displayName,
          message: `Legacy configuration migration failed: ${String(error)}`,
        });
      }
    }
    const defaults = ctx.settings
      .describe({ redactSecrets: true })
      .find((d) => String(d.ns) === "agent-default-model");
    if (legacy.defaultSelection && defaults && !defaults.user)
      await ctx.settings.mutate(
        defaults.ns,
        Object.entries(legacy.defaultSelection).map(([key, value]) => ({
          op: "set" as const,
          path: [key],
          value,
        })),
        defaults.revision,
      );
    prefs.hiddenProviders = legacy.providers
      .filter((p) => !p.enabled)
      .map((p) => p.id);
    prefs.hiddenModels = Object.fromEntries(
      legacy.providers.map((p) => [
        p.id,
        p.models.filter((m) => m.enabled === false).map((m) => m.id),
      ]),
    );
  }
  await store.set({ [PREFS]: { ...prefs, migrated: true } });

  return prefs;
}
