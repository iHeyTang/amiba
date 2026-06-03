import type { ExtensionManifest } from "@hermes-x/extension-api"

export type ValidationResult =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; error: string }

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const SEMVER_RE = /^\d+\.\d+\.\d+/

export function validateManifest(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "manifest is not an object" }
  }
  const m = raw as Record<string, unknown>

  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    return { ok: false, error: `invalid id (must be reverse-DNS): ${String(m.id)}` }
  }
  if (typeof m.name !== "string" || m.name.length === 0) {
    return { ok: false, error: "missing name" }
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    return { ok: false, error: `invalid version: ${String(m.version)}` }
  }
  const entries = m.entries as Record<string, unknown> | undefined
  if (
    !entries ||
    (typeof entries.main !== "string" && typeof entries.renderer !== "string")
  ) {
    return { ok: false, error: "entries must include main and/or renderer" }
  }

  const contributes = m.contributes as Record<string, unknown> | undefined
  if (contributes && Array.isArray(contributes.sidebarViews)) {
    for (const v of contributes.sidebarViews as Array<Record<string, unknown>>) {
      if (typeof v.anchor !== "string" || !v.anchor.startsWith("activityBar:")) {
        return { ok: false, error: `sidebarView anchor must start with "activityBar:": ${String(v.anchor)}` }
      }
    }
  }

  return { ok: true, manifest: raw as ExtensionManifest }
}
