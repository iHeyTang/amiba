import { existsSync, realpathSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

/** Match DSH's node_modules lookup without requiring a package.json export. */
export function resolveInstalledPackageDirectory(anchor: string, packageName: string): string {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)) {
    throw new Error("Invalid package name")
  }
  for (const directory of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = path.join(directory, packageName)
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate)
  }
  throw Object.assign(new Error(`Cannot find package '${packageName}' from ${anchor}`), { code: "MODULE_NOT_FOUND" })
}
