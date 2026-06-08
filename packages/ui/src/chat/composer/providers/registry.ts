import type { TriggerProvider } from "./types"
import { makeSkillsProvider } from "./skills"
import { makeSlashProvider } from "./slash"
import { makeSessionsProvider } from "./sessions"
import { makePersonasProvider } from "./personas"
import { makeChannelsProvider } from "./channels"
import { loadMentionResourceProviders } from "./mention-resources"

export interface ProviderRegistry {
  all: TriggerProvider[]
  forTrigger(trigger: "/" | "@"): TriggerProvider[]
}

export function buildProviderRegistry(extra: TriggerProvider[] = []): ProviderRegistry {
  const builtin: TriggerProvider[] = [makeSkillsProvider(), makeSlashProvider(), makeSessionsProvider(), makePersonasProvider(), makeChannelsProvider()]
  const all = [...builtin, ...extra]
  return {
    all,
    forTrigger: (trigger) => all.filter((p) => p.trigger === trigger),
  }
}

/**
 * Like {@link buildProviderRegistry}, but also pulls the backplane's
 * mention-resource registry (GET /hermes/mention-resources) and adds one
 * generic provider per declared resource type (e.g. `lark.doc`). Host-supplied
 * `extra` providers (Files on desktop, Page-context on the extension) still
 * win their slots. Degrades to built-ins + extra when the backplane is down.
 */
export async function buildProviderRegistryAsync(extra: TriggerProvider[] = []): Promise<ProviderRegistry> {
  const dynamic = await loadMentionResourceProviders()
  return buildProviderRegistry([...dynamic, ...extra])
}
