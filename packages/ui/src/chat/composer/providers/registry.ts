import type { TriggerProvider } from "./types"
import { makeSkillsProvider } from "./skills"
import { makeSlashProvider } from "./slash"
import { makeSessionsProvider } from "./sessions"

export interface ProviderRegistry {
  all: TriggerProvider[]
  forTrigger(trigger: "/" | "@"): TriggerProvider[]
}

export function buildProviderRegistry(
  extra: TriggerProvider[] = [],
  context: { sessionId?: string } = {},
): ProviderRegistry {
  const builtin: TriggerProvider[] = [
    makeSkillsProvider(context.sessionId),
    makeSlashProvider(context.sessionId),
    makeSessionsProvider(),
  ]
  const all = [...builtin, ...extra]
  return {
    all,
    forTrigger: (trigger) => all.filter((p) => p.trigger === trigger),
  }
}

/**
 * Async form retained for callers that compose host-provided providers.
 */
export async function buildProviderRegistryAsync(
  extra: TriggerProvider[] = [],
  context: { sessionId?: string } = {},
): Promise<ProviderRegistry> {
  return buildProviderRegistry(extra, context)
}
