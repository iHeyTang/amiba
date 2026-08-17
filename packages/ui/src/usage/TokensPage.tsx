/**
 * Tokens page shell — the "Tokens" sidebar destination.
 *
 * Kept as a thin re-export so the settings registry has a stable import;
 * SettingsPageScaffold owns all page chrome (title, scroll, width) — see
 * TokensTab for the actual content.
 */

import { TokensTab } from "./TokensTab"

export function TokensPage() {
  return <TokensTab />
}
