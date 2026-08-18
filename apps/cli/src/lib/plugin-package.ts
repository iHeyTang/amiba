import { readFileSync } from "node:fs"
import { join } from "node:path"

export interface DshPluginPackage {
  name: string
  version: string
  dsh?: { client?: { inject?: string[]; platform?: string } }
}

export function readDshPluginPackage(cwd: string): DshPluginPackage {
  const value = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Partial<DshPluginPackage>
  if (typeof value.name !== "string" || !/(?:^|\/)dsh-plugin-[a-z0-9-]+$/u.test(value.name)) {
    throw new Error("package name must start with dsh-plugin- (optionally inside an npm scope)")
  }
  if (typeof value.version !== "string" || !value.version.trim()) {
    throw new Error("package.json must declare a version")
  }
  return value as DshPluginPackage
}
