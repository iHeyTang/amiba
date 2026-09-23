import type { PresetOption } from "./connector-ui-registry.js";

/**
 * Minimal shape of the engine-native wire face this reads — the same
 * `ctx.remote.agentPresets.list()` that `dsh-plugin-agent-preset`'s
 * client/data.ts consumes (so the reading fiber must declare
 * `remote.agentPresets` in its `inject`). Kept structural so the client half
 * never has to import a DSH connection type here.
 */
export type PresetConnection = Pick<import("@deepseek-ai/dsh-api-remotes/client").ClientRemote, "agentPresets">;

interface RawEntry {
  id?: unknown;
  name?: unknown;
  isDefault?: unknown;
}

/**
 * Read the installed agent presets as picker options; [] on any failure.
 *
 * The call resolves to the bare result envelope `{ ok, value }` — the shape
 * DSH 0.1.5-rc.2 `remote.<namespace>` methods return, read the same way by
 * `dsh-plugin-agent-preset`'s `client/data.ts` `unwrap()`; `value.presets`
 * carries camelCase `AgentPresetEntry` rows. `name` is the display name and
 * falls back to `id` (DSH's own contract); `description` is a longer blurb
 * and is NOT the label.
 */
export async function loadAgentPresets(
  connection: PresetConnection,
): Promise<PresetOption[]> {
  let response: unknown;
  try {
    response = await connection.agentPresets.list();
  } catch {
    return [];
  }
  if (!response || typeof response !== "object") return [];
  const result = response;
  if (!result || typeof result !== "object") return [];
  const { ok, value } = result as { ok?: unknown; value?: unknown };
  if (ok !== true || !value || typeof value !== "object") return [];
  const presets = (value as { presets?: unknown }).presets;
  if (!Array.isArray(presets)) return [];
  return presets.flatMap((raw): PresetOption[] => {
    const entry = raw as RawEntry;
    if (typeof entry.id !== "string" || !entry.id) return [];
    const label =
      typeof entry.name === "string" && entry.name.trim() ? entry.name : entry.id;
    return [{ id: entry.id, label, isDefault: entry.isDefault === true }];
  });
}
