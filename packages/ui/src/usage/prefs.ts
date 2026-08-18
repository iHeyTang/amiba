/**
 * Tiny persisted-prefs helper for the Usage page, backed by the
 * platform storage adapter. Reads fall back silently; writes are
 * fire-and-forget — a failed persist should never break the UI.
 *
 * Tokens moved into `@amiba/dsh-plugin-usage` (its own copy at
 * `plugins/dsh-plugin-usage/src/client/prefs.ts`); this host copy stays
 * only for `ToolsActivityTab`, which hasn't migrated yet (tool-activity
 * metering moves in a later surgery). Once that lands, delete this file
 * and its lone remaining consumer moves to the plugin copy.
 */

import { getPlatform } from "@amiba/app-runtime/platform"

export async function readUsagePref<T>(key: string, fallback: T): Promise<T> {
  try {
    const r = await getPlatform().storage.get(key)
    const v = r[key]
    return (v as T) ?? fallback
  } catch {
    return fallback
  }
}

export function writeUsagePref(key: string, value: unknown): void {
  void getPlatform()
    .storage.set({ [key]: value })
    .catch(() => {})
}
