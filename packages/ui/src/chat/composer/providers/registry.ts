import type { TriggerProvider } from "./types"
import { makeSkillsProvider } from "./skills"

export interface ProviderRegistry {
  all: TriggerProvider[]
  forTrigger(trigger: "/" | "@"): TriggerProvider[]
}

export function buildProviderRegistry(extra: TriggerProvider[] = []): ProviderRegistry {
  const builtin: TriggerProvider[] = [makeSkillsProvider()]
  const all = [...builtin, ...extra]
  return {
    all,
    forTrigger: (trigger) => all.filter((p) => p.trigger === trigger),
  }
}
