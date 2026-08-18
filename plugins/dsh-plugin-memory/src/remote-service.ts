import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { AmibaMemoryStore, AmibaMemoryTarget } from "./memory-store.js";

const FALLBACK_PRESET = "standard";

/** The slice of `@deepseek-ai/dsh-agent-presets`' `AgentPresets` service this
 *  module actually reads — kept minimal so a mocked ctx in tests does not
 *  need to satisfy the whole upstream service shape. */
interface AgentPresetsRoster {
  list(): Promise<ReadonlyArray<{ id: string; broken?: string }>>;
}

type PresetsAwareContext = Context & { agentPresets?: AgentPresetsRoster };

/**
 * Every preset id the current agent-preset engine reports, filtered to
 * healthy ones. `null` when the engine roster is unreachable — no
 * `agentPresets` service composed, or the read itself fails — so the caller
 * can fall back to the storage-derived roster instead of surfacing an empty
 * switcher.
 */
async function enginePresetIds(ctx: Context): Promise<string[] | null> {
  const roster = (ctx as PresetsAwareContext).agentPresets;
  if (!roster) return null;
  try {
    const presets = await roster.list();
    const ids = presets
      .filter((preset) => !preset.broken)
      .map((preset) => preset.id);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the preset ids the memory settings UI should offer. Prefers the
 * live agent-preset engine roster when the cordis composition exposes one;
 * otherwise falls back to the union of every preset id that currently owns
 * stored memory and the conventional "standard" default, so the switcher
 * is never empty even on a deployment that never composed the presets
 * engine into this plugin's ctx.
 */
export async function resolveMemoryPresets(
  ctx: Context,
  store: AmibaMemoryStore,
): Promise<string[]> {
  const engineIds = await enginePresetIds(ctx);
  if (engineIds) return engineIds;
  const stored = await store.presetIds();
  return [...new Set([...stored, FALLBACK_PRESET])].sort();
}

class AmibaMemoryRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly store: AmibaMemoryStore,
  ) {
    super(ctx, "amibaMemory");
  }

  @Remote
  list(preset: string) {
    return this.store.read(preset);
  }

  @Remote
  presets() {
    return resolveMemoryPresets(this.ctx, this.store);
  }

  @Remote
  reset(preset: string, target: AmibaMemoryTarget | "all") {
    return this.store.reset(preset, target);
  }
}

/** Install the official DSH Host Remote face owned by this feature plugin. */
export function applyMemoryRemote(
  ctx: Context,
  store: AmibaMemoryStore,
): void {
  new AmibaMemoryRemoteService(ctx, store);
}

