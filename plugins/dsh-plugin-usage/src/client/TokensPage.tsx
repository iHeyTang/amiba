/**
 * Tokens page shell — the content the plugin's "usage" settings section
 * renders.
 *
 * Kept as a thin re-export, same role it played in the host registry: the
 * Settings shell (now the `amiba.settings.section` scaffold, previously
 * `SettingsPageScaffold` via `SETTINGS_PAGES`) owns the page's title and
 * scroll host; TokensTab owns its own inner ScrollArea and all content.
 */

import type { UsageListFn } from "./token-usage.js";
import { TokensTab } from "./TokensTab.js";

export function TokensPage({ list }: { list: UsageListFn }) {
  return <TokensTab list={list} />;
}
