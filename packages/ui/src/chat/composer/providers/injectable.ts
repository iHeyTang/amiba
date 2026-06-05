import type { TriggerProvider } from "./types"

/** Host apps build these and pass via Composer/ChatSurface mentionProviders. */
export type InjectableProvider = TriggerProvider

export interface MentionProvidersInput {
  /** Extra @ providers contributed by the host (files / page-context). */
  providers?: InjectableProvider[]
}
