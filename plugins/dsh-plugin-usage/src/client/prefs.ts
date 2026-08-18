/**
 * Tiny persisted-prefs helper for the Usage plugin's Tokens view, backed
 * by the platform storage adapter. Reads fall back silently; writes are
 * fire-and-forget — a failed persist should never break the UI.
 *
 * This is a deliberate fork of `packages/ui/src/usage/prefs.ts`, not a
 * shared import: that host copy still backs `ToolsActivityTab`, which
 * hasn't moved into this plugin yet (tool-activity metering is a
 * separate, later surgery). Once that migration lands, both copies
 * collapse back into one plugin-owned module.
 */

import { getPlatform } from "@amiba/app-runtime/platform";

export async function readUsagePref<T>(key: string, fallback: T): Promise<T> {
  try {
    const r = await getPlatform().storage.get(key);
    const v = r[key];
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeUsagePref(key: string, value: unknown): void {
  void getPlatform()
    .storage.set({ [key]: value })
    .catch(() => {});
}
