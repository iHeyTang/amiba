/**
 * Level assumed when a manifest omits `apiVersion` (legacy / minimal).
 * Intentionally fixed at 1 — independent of the current API_VERSION — so
 * pre-apiVersion manifests are always treated as targeting the oldest level.
 */
export const DEFAULT_API_VERSION = 1

export type CompatResult = { ok: true } | { ok: false; reason: string }

/**
 * An extension is compatible when the host implements an API level at
 * least as high as the extension requires. Absent `required` defaults to
 * DEFAULT_API_VERSION so pre-apiVersion manifests keep loading.
 */
export function checkCompat(
  required: number | undefined,
  hostApiVersion: number,
): CompatResult {
  const need = required ?? DEFAULT_API_VERSION
  if (need <= hostApiVersion) return { ok: true }
  return {
    ok: false,
    reason: `requires host extension API level ${need}, but this desktop implements ${hostApiVersion} — update the desktop app`,
  }
}
