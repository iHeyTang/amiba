import type { TriggerProvider } from "./types"
import { CommandClaimStore } from "../triggers/claim"
import { DraftRevision } from "../triggers/editor-ops"
import { TRIGGER_SOURCE_LABELS, localTriggerSources } from "./dsh-sources"
import { sourceToProvider } from "./source-adapter"

export interface ProviderRegistry {
  all: TriggerProvider[]
  forTrigger(trigger: "/" | "@"): TriggerProvider[]
}

export interface ProviderRegistryContext {
  sources?: readonly import("@amiba/extension-sdk").InputTriggerSource[]
  /** Session the built-in sources are asked about. */
  sessionId?: string
  /**
   * Shared command-mode store and draft revision. The composer passes its
   * own so a `{ claim }` pick on the home composer enters the same command
   * mode the in-session path enters; omitted (tests, send-time expansion)
   * they default to throwaway instances.
   */
  claims?: CommandClaimStore
  revision?: DraftRevision
  /**
   * Drop Amiba's own `/` and `@` sources. The IN-SESSION composer sets this:
   * there the same sources are registered with the official
   * `ctx.inputTriggers` service and rendered from the shadowed overlay seat,
   * so a second surface-local copy would mean two menus.
   */
  omitBuiltins?: boolean
  /** Menu group labels by source name. */
  labels?: Record<string, string>
}

/**
 * The SESSION-LESS trigger registry: Amiba's own sources adapted to the
 * surface-local provider shape, plus whatever the host contributed.
 *
 * There is no second definition of the built-ins here — `localTriggerSources`
 * returns the very `InputTriggerSource` objects the in-session path registers
 * with the official service, and `sourceToProvider` only re-shapes them.
 */
export function buildProviderRegistry(
  extra: TriggerProvider[] = [],
  context: ProviderRegistryContext = {},
): ProviderRegistry {
  const claims = context.claims ?? new CommandClaimStore()
  const revision = context.revision ?? new DraftRevision()
  const builtin = context.omitBuiltins
    ? []
    : [...localTriggerSources(context.sessionId), ...(context.sources ?? [])].map((source) =>
        sourceToProvider(source, {
          sessionId: context.sessionId,
          claims,
          revision,
          label:
            context.labels?.[source.name] ?? TRIGGER_SOURCE_LABELS[source.name],
        }),
      )
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
  context: ProviderRegistryContext = {},
): Promise<ProviderRegistry> {
  return buildProviderRegistry(extra, context)
}
