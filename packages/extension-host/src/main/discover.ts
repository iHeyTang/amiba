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
  if (m.apiVersion !== undefined) {
    if (
      typeof m.apiVersion !== "number" ||
      !Number.isInteger(m.apiVersion) ||
      m.apiVersion < 1
    ) {
      return {
        ok: false,
        error: `invalid apiVersion (must be an integer ≥ 1): ${String(m.apiVersion)}`,
      }
    }
  }
  const entries = m.entries as Record<string, unknown> | undefined
  if (!entries || typeof entries !== "object") {
    return { ok: false, error: "entries must be an object (all keys optional)" }
  }

  const contributes = m.contributes as Record<string, unknown> | undefined
  if (contributes) {
    if (contributes.main !== undefined) {
      const main = contributes.main as Record<string, unknown>
      if (typeof main.icon !== "string" || main.icon.length === 0) {
        return { ok: false, error: "contributes.main: icon must be a non-empty string" }
      }
      if (
        !main.labels ||
        typeof main.labels !== "object" ||
        Object.keys(main.labels as object).length === 0
      ) {
        return { ok: false, error: "contributes.main: labels must be a non-empty object" }
      }
      if (typeof main.view !== "string" || main.view.length === 0) {
        return { ok: false, error: "contributes.main: view must be a non-empty string" }
      }
    }

    if (contributes.settings !== undefined) {
      const settings = contributes.settings as Record<string, unknown>
      if (
        !settings.labels ||
        typeof settings.labels !== "object" ||
        Object.keys(settings.labels as object).length === 0
      ) {
        return { ok: false, error: "contributes.settings: labels must be a non-empty object" }
      }
      if (typeof settings.view !== "string" || settings.view.length === 0) {
        return { ok: false, error: "contributes.settings: view must be a non-empty string" }
      }
    }
  }

  return { ok: true, manifest: raw as ExtensionManifest }
}
