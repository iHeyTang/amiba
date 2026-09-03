import type { PluginTranslateFn } from "@amiba/ui/plugin";

/**
 * Maps known `ConnectorCenter` failure codes to translated copy. Shared by
 * every screen in this plugin that can surface a center failure — the
 * settings page's row mutations and the conversation seat's mount load —
 * so a wire code never reaches the user through one path while the other
 * translates it.
 */
export const KNOWN_CONNECT_ERRORS: Record<string, string> = {
  agent_preset_required: "options.connect.dsh.error.agent_preset_required",
  provider_not_found: "options.connect.dsh.error.provider_not_found",
  connect_not_found: "options.connect.dsh.error.connect_not_found",
  invalid_channel: "options.connect.dsh.error.invalid_channel",
  grant_not_found: "options.connect.dsh.error.grant_not_found",
  onboarding_not_found: "options.connect.dsh.error.onboarding_not_found",
  onboarding_unsupported: "options.connect.dsh.error.onboarding_unsupported",
};

/**
 * Translates a rejection into user-facing copy: a known code becomes its
 * catalog string, anything else falls through as its own message (the
 * caller has nothing better to show than the wire text).
 */
export function describeError(t: PluginTranslateFn, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const key = KNOWN_CONNECT_ERRORS[message];
  return key ? t(key) : message;
}
