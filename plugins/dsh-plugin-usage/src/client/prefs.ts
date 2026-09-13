/**
 * Tiny persisted-prefs helper for the Usage plugin's Tokens and Tools
 * views, backed by the platform storage adapter. Reads fall back
 * silently; writes are fire-and-forget — a failed persist should never
 * break the UI.
 *
 * The sole owner since T9: the host fork (`packages/ui/src/usage/prefs.ts`)
 * was deleted when `ToolsActivityTab` moved into this plugin. Pref keys
 * are unchanged, so previously stored day-range choices carry over.
 */

import { getPlatform } from "@amiba/dsh-plugin-ui-shell/client";

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
