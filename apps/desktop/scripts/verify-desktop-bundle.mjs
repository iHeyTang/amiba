import fs from "node:fs"
import { builtinModules } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const manifest = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"))
const runtimeDependencies = new Set(Object.keys(manifest.dependencies ?? {}))
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "electron",
])
const artifacts = [
  path.join(desktopDir, "out", "main", "index.js"),
  path.join(desktopDir, "out", "preload", "index.js"),
]

for (const artifact of artifacts) {
  if (!fs.existsSync(artifact)) {
    throw new Error(`[desktop:bundle] missing artifact ${artifact}`)
  }
  const source = fs.readFileSync(artifact, "utf8")
  const externalWorkspaceImport = source.match(
    /(?:require\(|from\s+|import\()\s*["'](@amiba\/[^"']+)["']/u,
  )
  if (externalWorkspaceImport) {
    throw new Error(
      `[desktop:bundle] ${artifact} still imports TypeScript-only workspace package ${externalWorkspaceImport[1]}`,
    )
  }
  for (const match of source.matchAll(/require\(\s*["']([^"']+)["']\s*\)/gu)) {
    const specifier = match[1]
    if (!specifier || specifier.startsWith(".") || builtins.has(specifier)) continue
    const parts = specifier.split("/")
    const packageName = specifier.startsWith("@")
      ? `${parts[0]}/${parts[1]}`
      : parts[0]
    if (!packageName || runtimeDependencies.has(packageName)) continue
    throw new Error(
      `[desktop:bundle] ${artifact} requires undeclared production dependency ${packageName}`,
    )
  }
}

const mainBundle = fs.readFileSync(artifacts[0], "utf8")
if (
  mainBundle.includes("apps/desktop/dsh-runtime-manifest.json") ||
  mainBundle.includes('new URL("../../dsh-runtime-manifest.json"')
) {
  throw new Error(
    "[desktop:bundle] managed DSH manifest was left as a bundle-relative filesystem lookup",
  )
}
if (!mainBundle.includes("packages/app-runtime/resources/dsh-runtime")) {
  throw new Error(
    "[desktop:bundle] development runtime path does not target app-runtime resources",
  )
}

console.log("[desktop:bundle] verified workspace bundling and production dependencies")
