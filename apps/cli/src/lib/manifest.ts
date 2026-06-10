import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { ExtensionManifest } from "@hermes-x/extension-api"

export function readExtensionManifest(cwd: string): ExtensionManifest {
  const p = join(cwd, "manifest.json")
  if (!existsSync(p)) {
    throw new Error(`no manifest.json found at ${p} — are you in an extension directory?`)
  }
  return JSON.parse(readFileSync(p, "utf8")) as ExtensionManifest
}
