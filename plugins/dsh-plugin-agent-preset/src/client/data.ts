/**
 * Plugin-local data plane over the engine-native agent-preset wire face.
 *
 * The official `@deepseek-ai/dsh-client-ui-agent-preset` reference consumes
 * `ctx.get("connection").api.agentPresets.{list,select,read,copy,openDocument,
 * remove}` (the connection service's `IApiClient`) plus the `agent-presets`
 * settings namespace for default-preset writes. This module mirrors that
 * exactly — zero host platform-adapter crossing — while keeping the response
 * semantics of the retired host helpers
 * (`packages/app-runtime/src/core/agent-presets.ts`) so the moved page code
 * stays unchanged.
 */

import type { ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client";

/** Wire api face this adapter consumes (`ctx.get("connection").api`). */
export type AgentPresetsApi = Pick<
  ConnectionHandle["api"],
  "agentPresets" | "settings"
>;

/** Settings namespace carrying the user's chosen default preset. */
const SETTINGS_NAMESPACE = "agent-presets";

export interface AgentPreset {
  name: string;
  is_default: boolean;
  description: string;
  trust: "system" | "user";
  broken?: string;
}

export interface AgentPresetsResponse {
  ok: boolean;
  profiles: AgentPreset[];
  active: string;
  error?: string;
}

export interface AgentPresetsAdapter {
  getAgentPresets(): Promise<AgentPresetsResponse>;
  createAgentPreset(input: {
    name: string;
    clone_from?: string;
    displayName?: string;
  }): Promise<{ ok: boolean; error?: string }>;
  renameAgentPreset(
    name: string,
    newName: string,
  ): Promise<{ ok: boolean; error?: string }>;
  deleteAgentPreset(name: string): Promise<{ ok: boolean; error?: string }>;
  setDefaultAgentPreset(name: string): Promise<{ ok: boolean; error?: string }>;
  readAgentPresetComposition(
    name: string,
  ): Promise<{ ok: boolean; content: string; error?: string }>;
  openAgentPresetDocument(
    name: string,
  ): Promise<{ ok: boolean; path?: string; error?: string }>;
}

export function normalizeAgentPresetId(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");
  if (!normalized) {
    throw new Error("Agent preset name must contain a letter or digit.");
  }
  return normalized;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fold both wire refusal shapes — a transport rejection and an `ok: false`
 * result envelope — into one thrown Error, mirroring the official client's
 * `readRoster` handling.
 */
async function unwrap<T>(
  call: Promise<{
    result:
      | { readonly ok: true; readonly value: T }
      | { readonly ok: false; readonly error: { readonly message: string } };
  }>,
): Promise<T> {
  const response = await call;
  if (!response.result.ok) throw new Error(response.result.error.message);
  return response.result.value;
}

export function createAgentPresetsAdapter(
  api: AgentPresetsApi,
): AgentPresetsAdapter {
  async function roster() {
    return unwrap(api.agentPresets.list({}));
  }

  async function writeDefault(name: string): Promise<void> {
    await unwrap(
      api.settings.update({ ns: SETTINGS_NAMESPACE, patch: { default: name } }),
    );
  }

  return {
    async getAgentPresets() {
      try {
        const { presets } = await roster();
        const active =
          presets.find((item) => item.isDefault)?.id ??
          presets[0]?.id ??
          "default";
        return {
          ok: true,
          active,
          profiles: presets.map((item) => ({
            name: item.id,
            is_default: item.isDefault,
            description: item.description ?? item.name ?? "",
            trust: item.trust,
            ...(item.broken === undefined ? {} : { broken: item.broken }),
          })),
        };
      } catch (error) {
        return {
          ok: false,
          profiles: [],
          active: "default",
          error: messageOf(error),
        };
      }
    },

    async createAgentPreset(input) {
      try {
        const { presets } = await roster();
        const from =
          input.clone_from ??
          presets.find((item) => item.isDefault)?.id ??
          presets[0]?.id;
        if (!from) {
          return { ok: false, error: "No DSH preset is available to copy." };
        }
        await unwrap(
          api.agentPresets.copy({
            from,
            agentPreset: normalizeAgentPresetId(input.name),
            ...(input.displayName?.trim()
              ? { name: input.displayName.trim() }
              : {}),
          }),
        );
        return { ok: true };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },

    async renameAgentPreset(name, newName) {
      try {
        const { presets } = await roster();
        const wasDefault = presets.some(
          (preset) => preset.id === name && preset.isDefault,
        );
        const nextId = normalizeAgentPresetId(newName);
        await unwrap(
          api.agentPresets.copy({
            from: name,
            agentPreset: nextId,
            name: newName.trim(),
          }),
        );
        if (wasDefault) {
          try {
            await writeDefault(nextId);
          } catch (error) {
            await unwrap(
              api.agentPresets.remove({ agentPreset: nextId }),
            ).catch(() => undefined);
            throw error;
          }
        }
        await unwrap(api.agentPresets.remove({ agentPreset: name }));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },

    async deleteAgentPreset(name) {
      try {
        const { presets } = await roster();
        if (presets.some((preset) => preset.id === name && preset.isDefault)) {
          return {
            ok: false,
            error:
              "Choose another default DSH agent preset before removing this one.",
          };
        }
        await unwrap(api.agentPresets.remove({ agentPreset: name }));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },

    async setDefaultAgentPreset(name) {
      try {
        await writeDefault(name);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },

    async readAgentPresetComposition(name) {
      try {
        const preset = await unwrap(
          api.agentPresets.read({ agentPreset: name }),
        );
        return { ok: true, content: preset.content };
      } catch (error) {
        return { ok: false, content: "", error: messageOf(error) };
      }
    },

    async openAgentPresetDocument(name) {
      try {
        const result = await unwrap(
          api.agentPresets.openDocument({ agentPreset: name }),
        );
        return result.opened ? { ok: true } : { ok: true, path: result.path };
      } catch (error) {
        return { ok: false, error: messageOf(error) };
      }
    },
  };
}
