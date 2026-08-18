import type { Context } from "@deepseek-ai/cordis";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import type {
  ModelCredentialVault,
  ModelProviderProjection,
} from "./plane/index.js";
import type { ModelProviderProfile } from "@amiba/app-runtime/platform";
import {
  apiForDshProvider,
  bindingForDshProvider,
  deepSeekModelRows,
  piAiModelRows,
} from "@amiba/app-runtime/model-plane-dsh";

function descriptor(ctx: Context, namespace: string) {
  const entry = ctx.settings
    .describe()
    .find((candidate) => String(candidate.ns) === namespace);
  if (!entry) {
    throw new Error(`DSH settings namespace ${namespace} is unavailable`);
  }
  return entry;
}

export function dshCredentialVault(ctx: Context): ModelCredentialVault {
  return {
    async describe(refs) {
      return Object.fromEntries(
        await Promise.all(
          refs.map(async (ref) => [ref, await ctx.credentials.describe(credentialRef(ref))]),
        ),
      );
    },
    async resolve(ref) {
      return (await ctx.credentials.resolve(credentialRef(ref)))?.value;
    },
    set: (ref, value) => ctx.credentials.set(credentialRef(ref), value),
    unset: (ref) => ctx.credentials.unset(credentialRef(ref)),
  };
}

/** Project the canonical plane into the active DSH execution harness. */
export function dshModelProjection(ctx: Context): ModelProviderProjection {
  return {
    async project(provider: ModelProviderProfile) {
      const binding = bindingForDshProvider(provider);
      const current = descriptor(ctx, binding.settingsNs);
      if (binding.settingsPath.length === 0) {
        await ctx.settings.mutate(
          settingsNamespace(binding.settingsNs),
          [
            { op: "set", path: ["models"], value: deepSeekModelRows(provider.models) },
            provider.credentialRef
              ? { op: "set", path: ["apiKeyEnv"], value: provider.credentialRef }
              : { op: "unset", path: ["apiKeyEnv"] },
            provider.baseURL
              ? { op: "set", path: ["baseURL"], value: provider.baseURL }
              : { op: "unset", path: ["baseURL"] },
          ],
          current.revision,
        );
        return;
      }
      await ctx.settings.mutate(
        settingsNamespace(binding.settingsNs),
        [
          {
            op: "set",
            path: binding.settingsPath,
            value: {
              displayName: provider.displayName,
              ...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
              api: apiForDshProvider(provider),
              models: piAiModelRows(provider.models),
              ...(provider.credentialRef
                ? { apiKeyEnv: provider.credentialRef }
                : {}),
            },
          },
        ],
        current.revision,
      );
    },
    async remove(provider) {
      const binding = bindingForDshProvider(provider);
      if (binding.settingsPath.length === 0) return;
      const current = descriptor(ctx, binding.settingsNs);
      await ctx.settings.mutate(
        settingsNamespace(binding.settingsNs),
        [{ op: "unset", path: binding.settingsPath }],
        current.revision,
      );
    },
    async unsetCredential() {
      // The canonical vault is ctx.credentials itself; ModelPlaneService has
      // already removed the value before invoking this projection callback.
    },
  };
}
