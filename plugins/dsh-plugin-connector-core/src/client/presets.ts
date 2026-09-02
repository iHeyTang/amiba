import type { PresetOption } from "./wizard-registry.js";

/**
 * Minimal shape of the engine-native connection face this reads — the same
 * `ctx.get("connection").api.agentPresets.list({})` that
 * `dsh-plugin-agent-preset`'s client/data.ts consumes. Kept structural so the
 * client half never has to import a DSH connection type here.
 */
export interface PresetConnection {
  api: { agentPresets: { list(input: object): Promise<unknown> } };
}

interface RawProfile {
  name?: unknown;
  description?: unknown;
  is_default?: unknown;
}

/** Read the installed agent presets as picker options; [] on any failure. */
export async function loadAgentPresets(
  connection: PresetConnection,
): Promise<PresetOption[]> {
  let response: unknown;
  try {
    response = await connection.api.agentPresets.list({});
  } catch {
    return [];
  }
  if (!response || typeof response !== "object") return [];
  const { ok, profiles } = response as { ok?: unknown; profiles?: unknown };
  if (ok !== true || !Array.isArray(profiles)) return [];
  return profiles.flatMap((raw): PresetOption[] => {
    const profile = raw as RawProfile;
    if (typeof profile.name !== "string" || !profile.name) return [];
    const label =
      typeof profile.description === "string" && profile.description.trim()
        ? profile.description
        : profile.name;
    return [{ id: profile.name, label, isDefault: profile.is_default === true }];
  });
}
