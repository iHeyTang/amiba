import { getPlatform } from "@amiba/app-runtime/platform";

export interface AgentPreset {
  name: string;
  path: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  has_env: boolean;
  skill_count: number;
  description: string;
  description_auto: boolean;
  distribution_name: string | null;
  distribution_version: string | null;
  distribution_source: string | null;
  soul_exists: boolean;
  trust: "system" | "user";
  broken?: string;
}

export interface AgentPresetsResponse {
  ok: boolean;
  profiles: AgentPreset[];
  active: string;
  current: string;
  error?: string;
}

function adapter() {
  const value = getPlatform().agentPresets;
  if (!value) throw new Error("DSH agent presets are unavailable.");
  return value;
}

export function normalizeAgentPresetId(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[-_]+|[-_]+$/gu, "");
  if (!normalized) throw new Error("Agent preset name must contain a letter or digit.");
  return normalized;
}

export async function getAgentPresets(): Promise<AgentPresetsResponse> {
  try {
    const roster = await adapter().list();
    const active =
      roster.presets.find((item) => item.isDefault)?.id ??
      roster.presets[0]?.id ??
      "default";
    return {
      ok: true,
      active,
      current: active,
      profiles: roster.presets.map((item) => ({
        name: item.id,
        path: "",
        is_default: item.isDefault,
        model: null,
        provider: null,
        has_env: false,
        skill_count: 0,
        description: item.description ?? item.name ?? "",
        description_auto: false,
        distribution_name: null,
        distribution_version: null,
        distribution_source: item.trust,
        soul_exists: true,
        trust: item.trust,
        broken: item.broken,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      profiles: [],
      active: "default",
      current: "default",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createAgentPreset(input: {
  name: string;
  clone_from?: string;
  displayName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const presets = adapter();
    const roster = await presets.list();
    const from =
      input.clone_from ??
      roster.presets.find((item) => item.isDefault)?.id ??
      roster.presets[0]?.id;
    if (!from) return { ok: false, error: "No DSH preset is available to copy." };
    await presets.copy({
      from,
      agentPreset: normalizeAgentPresetId(input.name),
      ...(input.displayName?.trim() ? { name: input.displayName.trim() } : {}),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function renameAgentPreset(
  name: string,
  newName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const presets = adapter();
    const roster = await presets.list();
    const wasDefault = roster.presets.some(
      (preset) => preset.id === name && preset.isDefault,
    );
    const nextId = normalizeAgentPresetId(newName);
    await presets.copy({
      from: name,
      agentPreset: nextId,
      name: newName.trim(),
    });
    if (wasDefault) {
      const settings = getPlatform().agentSettings;
      if (!settings) {
        await presets.remove(nextId).catch(() => undefined);
        return { ok: false, error: "DSH settings are unavailable." };
      }
      try {
        await settings.update("agent-presets", { default: nextId });
      } catch (error) {
        await presets.remove(nextId).catch(() => undefined);
        throw error;
      }
    }
    await presets.remove(name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function deleteAgentPreset(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const presets = adapter();
    const roster = await presets.list();
    if (roster.presets.some((preset) => preset.id === name && preset.isDefault)) {
      return {
        ok: false,
        error: "Choose another default DSH agent preset before removing this one.",
      };
    }
    await presets.remove(name);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function setDefaultAgentPreset(
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const settings = getPlatform().agentSettings;
  if (!settings) return { ok: false, error: "DSH settings are unavailable." };
  try {
    await settings.update("agent-presets", { default: name });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readAgentPresetComposition(
  name: string,
): Promise<{ ok: boolean; content: string; exists: boolean; error?: string }> {
  try {
    const preset = await adapter().read(name);
    return { ok: true, content: preset.content, exists: true };
  } catch (error) {
    return {
      ok: false,
      content: "",
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function updateAgentPresetComposition(
  _name: string,
  _content: string,
): Promise<{
  ok: false;
  error: string;
}> {
  return Promise.resolve({
    ok: false,
    error: "DSH preset composition is edited in its source document.",
  });
}

export function updateAgentPresetDescription(
  _name: string,
  _description: string,
): Promise<{
  ok: false;
  error: string;
}> {
  return Promise.resolve({
    ok: false,
    error: "DSH preset metadata is edited in its source document.",
  });
}

export async function openAgentPresetDocument(
  name: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const result = await adapter().openDocument(name);
    return result.opened ? { ok: true } : { ok: true, path: result.path };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
