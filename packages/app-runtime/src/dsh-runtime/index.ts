import { existsSync, readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import runtimeManifest from "../../dsh-runtime-manifest.json" with { type: "json" }
import {
  AMIBA_DSH_BUNDLES,
  amibaDshProfileBundles,
  amibaDshProfileManifest,
  amibaDshProfileName,
  type AmibaDshSurface,
} from "@amiba/app-runtime/dsh-distribution"

export type { AmibaDshSurface } from "@amiba/app-runtime/dsh-distribution"

export interface ManagedDshRuntimeManifest {
  schemaVersion: number
  bundleSchemaVersion: number
  amibaPluginRevision: string
  repository: string
  version: string
  nodeVersion: string
}

export const MANAGED_DSH_RUNTIME: Readonly<ManagedDshRuntimeManifest> =
  Object.freeze(runtimeManifest)

export function assertValidManagedDshRuntimeManifest(
  manifest: Readonly<ManagedDshRuntimeManifest> = MANAGED_DSH_RUNTIME,
): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error(`Unsupported DSH runtime manifest schema: ${manifest.schemaVersion}`)
  }
  if (!Number.isInteger(manifest.bundleSchemaVersion) || manifest.bundleSchemaVersion < 1) {
    throw new Error("Managed DSH bundle schema is invalid")
  }
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(manifest.amibaPluginRevision)) {
    throw new Error("Managed Amiba DSH plugin revision is invalid")
  }
  // An exact release candidate, not a range — DSH has shipped nothing but
  // prereleases, and semver will not match one against a range whose
  // major/minor/patch tuple differs. The minor version is deliberately NOT
  // baked in here: this check is about the SHAPE of the pin, and hard-coding
  // `0.1.0` made a routine upstream bump fail a format validator.
  if (!/^\d+\.\d+\.\d+-rc\.\d+$/u.test(manifest.version)) {
    throw new Error("Managed DSH version must pin an exact release candidate")
  }
  if (!/^22\.\d+\.\d+$/u.test(manifest.nodeVersion)) {
    throw new Error("Managed DSH Node version must pin a 22.x patch release")
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(manifest.repository)) {
    throw new Error("Managed DSH repository must be an owner/name pair")
  }
}

export interface ResolveManagedDshRuntimeDirOptions {
  explicit?: string
  env?: NodeJS.ProcessEnv
  moduleUrl?: string
}

/** Resolve the app-runtime-managed artifact, never a system DSH install. */
export function resolveManagedDshRuntimeDir(
  options: ResolveManagedDshRuntimeDirOptions = {},
): string {
  const configured =
    options.explicit?.trim() || options.env?.AMIBA_DSH_RUNTIME_DIR?.trim()
  if (configured) return path.resolve(configured)
  return fileURLToPath(
    new URL("../../resources/dsh-runtime", options.moduleUrl ?? import.meta.url),
  )
}

/** Resolve the copy embedded by an application packager. */
export function resolvePackagedManagedDshRuntimeDir(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix
  if (!pathApi.isAbsolute(resourcesPath)) {
    throw new Error("Packaged application resources path must be absolute")
  }
  return pathApi.join(resourcesPath, "resources", "dsh-runtime")
}

export function resolveAmibaDshHomes(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
): string[] {
  const configured =
    explicit?.trim() || env.AMIBA_DSH_HOME?.trim() || env.DSH_HOME?.trim()
  if (configured) return [path.resolve(configured)]

  const userDataRoot = env.AMIBA_USER_DATA_DIR?.trim()
  if (userDataRoot) return [path.resolve(userDataRoot, "dsh", "home")]

  const roots =
    platform === "darwin"
      ? [
          path.join(userHome, "Library", "Application Support", "@amiba", "desktop"),
          path.join(userHome, "Library", "Application Support", "Amiba"),
        ]
      : platform === "win32"
        ? [
            path.join(
              env.APPDATA?.trim() || path.join(userHome, "AppData", "Roaming"),
              "@amiba",
              "desktop",
            ),
            path.join(
              env.APPDATA?.trim() || path.join(userHome, "AppData", "Roaming"),
              "Amiba",
            ),
          ]
        : [
            path.join(
              env.XDG_CONFIG_HOME?.trim() || path.join(userHome, ".config"),
              "@amiba",
              "desktop",
            ),
            path.join(
              env.XDG_CONFIG_HOME?.trim() || path.join(userHome, ".config"),
              "Amiba",
            ),
          ]
  return roots.map(root => path.join(root, "dsh", "home"))
}

/** Include isolated previews in plugin development discovery; explicit homes stay authoritative. */
export function resolveAmibaDshDevelopmentHomes(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
): string[] {
  const homes = resolveAmibaDshHomes(explicit, env, platform, userHome)
  if (explicit?.trim() || env.AMIBA_DSH_HOME?.trim() || env.DSH_HOME?.trim() || env.AMIBA_USER_DATA_DIR?.trim()) return homes
  return [...homes.map(home => path.join(`${path.dirname(path.dirname(home))}-dev`, "dsh", "home")), ...homes]
}

export function resolveAmibaDshHome(
  explicit?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  userHome = homedir(),
): string {
  const homes = resolveAmibaDshHomes(explicit, env, platform, userHome)
  return homes.find(home => existsSync(home)) ?? homes.at(-1)!
}

export interface ManagedDshPaths {
  surface: AmibaDshSurface
  profileName: string
  root: string
  home: string
  agentsHome: string
  runtimeDir: string
  runtimeBinDir: string
  runtimeAppBinDir: string
  node: string
  entrypoint: string
  amibaBundleManifests: readonly string[]
  amibaBundlePatches: readonly string[]
  profileDir: string
  profileManifest: string
  profilePatch: string
  profileManagedPatch: string
  profileWorkspace: string
  profileLock: string
  bundleMarker: string
}

export function resolveManagedDshRuntimePaths(options: {
  surface: AmibaDshSurface
  home: string
  runtimeDir?: string
  agentsHome?: string
  platform?: NodeJS.Platform
}): ManagedDshPaths {
  assertValidManagedDshRuntimeManifest()
  const platform = options.platform ?? process.platform
  const pathApi = platform === "win32" ? path.win32 : path.posix
  if (!pathApi.isAbsolute(options.home)) {
    throw new Error("Amiba DSH home directory must be absolute")
  }
  const runtimeDir = pathApi.normalize(
    options.runtimeDir ?? resolveManagedDshRuntimeDir(),
  )
  if (!pathApi.isAbsolute(runtimeDir)) {
    throw new Error("Amiba managed DSH runtime directory must be absolute")
  }
  const home = pathApi.normalize(options.home)
  const root = pathApi.dirname(home)
  const agentsHome = options.agentsHome
    ? pathApi.normalize(options.agentsHome)
    : pathApi.join(root, "agents")
  if (!pathApi.isAbsolute(agentsHome)) {
    throw new Error("Amiba DSH agents directory must be absolute")
  }
  const profileName = amibaDshProfileName(options.surface)
  const profileDir = pathApi.join(home, "profiles", profileName)
  const runtimeBinDir =
    platform === "win32"
      ? pathApi.join(runtimeDir, "node")
      : pathApi.join(runtimeDir, "node", "bin")
  const runtimeAppDir = pathApi.join(runtimeDir, "app")
  const amibaBundles = amibaDshProfileBundles(options.surface).filter((name) =>
    name.startsWith("@amiba/"),
  )
  return {
    surface: options.surface,
    profileName,
    root,
    home,
    agentsHome,
    runtimeDir,
    runtimeBinDir,
    runtimeAppBinDir: pathApi.join(runtimeAppDir, "node_modules", ".bin"),
    node:
      platform === "win32"
        ? pathApi.join(runtimeDir, "node", "node.exe")
        : pathApi.join(runtimeDir, "node", "bin", "node"),
    entrypoint: pathApi.join(
      runtimeAppDir,
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    ),
    amibaBundleManifests: amibaBundles.map((name) =>
      pathApi.join(
        runtimeAppDir,
        "node_modules",
        "@amiba",
        name.slice("@amiba/".length),
        "package.json",
      ),
    ),
    amibaBundlePatches: amibaBundles.map((name) =>
      pathApi.join(
        runtimeAppDir,
        "node_modules",
        "@amiba",
        name.slice("@amiba/".length),
        "cordis.patch.yml",
      ),
    ),
    profileDir,
    profileManifest: pathApi.join(profileDir, "package.json"),
    profilePatch: pathApi.join(profileDir, "cordis.patch.yml"),
    profileManagedPatch: pathApi.join(profileDir, "amiba.managed.patch.yml"),
    profileWorkspace: pathApi.join(profileDir, "pnpm-workspace.yaml"),
    profileLock: pathApi.join(profileDir, "pnpm-lock.yaml"),
    bundleMarker: pathApi.join(runtimeDir, "runtime-manifest.json"),
  }
}

/** Convenience for product hosts whose DSH home lives under userData/dsh. */
export function resolveManagedDshPaths(
  userDataDir: string,
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
  surface: AmibaDshSurface = "desktop",
): ManagedDshPaths {
  const pathApi = platform === "win32" ? path.win32 : path.posix
  if (!pathApi.isAbsolute(userDataDir)) {
    throw new Error("Amiba userData directory must be absolute")
  }
  const root = pathApi.join(userDataDir, "dsh")
  return resolveManagedDshRuntimePaths({
    surface,
    home: pathApi.join(root, "home"),
    agentsHome: pathApi.join(root, "agents"),
    runtimeDir,
    platform,
  })
}

export interface ManagedDshRuntimeMarker {
  schemaVersion: number
  dshVersion: string
  nodeVersion: string
  amibaPluginRevision: string
  platform: NodeJS.Platform
  arch: string
  amibaSourceDigest?: string
  nodeSource?: string
  builtAt?: string
}

export function expectedManagedDshRuntimeMarker(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  manifest: Readonly<ManagedDshRuntimeManifest> = MANAGED_DSH_RUNTIME,
): ManagedDshRuntimeMarker {
  return {
    schemaVersion: manifest.bundleSchemaVersion,
    dshVersion: manifest.version,
    nodeVersion: manifest.nodeVersion,
    amibaPluginRevision: manifest.amibaPluginRevision,
    platform,
    arch,
  }
}

export function readManagedDshRuntimeMarker(
  runtimeDir = resolveManagedDshRuntimeDir(),
): ManagedDshRuntimeMarker {
  return JSON.parse(
    readFileSync(path.join(runtimeDir, "runtime-manifest.json"), "utf8"),
  ) as ManagedDshRuntimeMarker
}

export function verifyManagedDshRuntime(options: {
  runtimeDir?: string
  platform?: NodeJS.Platform
  arch?: string
} = {}): ManagedDshRuntimeMarker {
  const runtimeDir = options.runtimeDir ?? resolveManagedDshRuntimeDir()
  const marker = readManagedDshRuntimeMarker(runtimeDir)
  const expected = expectedManagedDshRuntimeMarker(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  )
  for (const [key, value] of Object.entries(expected)) {
    if (marker[key as keyof ManagedDshRuntimeMarker] !== value) {
      throw new Error(
        `Managed DSH Runtime is stale: expected ${key}=${value}, got ${marker[key as keyof ManagedDshRuntimeMarker]}`,
      )
    }
  }
  const paths = resolveManagedDshRuntimePaths({
    surface: "desktop",
    home: path.resolve(path.sep, "amiba-runtime-verification", "home"),
    runtimeDir,
    platform: options.platform,
  })
  for (const artifact of [
    paths.node,
    paths.entrypoint,
    ...paths.amibaBundleManifests,
    ...paths.amibaBundlePatches,
  ]) {
    if (!existsSync(artifact)) {
      throw new Error(`Managed DSH Runtime artifact is missing: ${artifact}`)
    }
  }
  return marker
}

export function managedDshProfileManifest(
  surface: AmibaDshSurface,
  current?: unknown,
): Record<string, unknown> {
  return amibaDshProfileManifest(surface, current)
}

export async function ensureManagedDshProfile(
  paths: ManagedDshPaths,
): Promise<void> {
  await mkdir(paths.profileDir, { recursive: true, mode: 0o700 })
  const existing = existsSync(paths.profileManifest)
    ? (JSON.parse(await readFile(paths.profileManifest, "utf8")) as unknown)
    : undefined
  const manifest = managedDshProfileManifest(paths.surface, existing) as {
    dependencies: Record<string, string>;
    dsh: { profile: { bundles: string[]; optionalBrowserMigration?: number } };
  }
  // Once-only migration: formerly part of Desktop's mandatory activation patch.
  // A user removal must survive every subsequent runtime restart.
  if (paths.surface === "desktop" && manifest.dsh.profile.optionalBrowserMigration !== 1) {
    const browser = "@amiba/dsh-plugin-browser-provider-electron"
    manifest.dependencies[browser] ??= `link:${path.join(paths.runtimeDir, "app/node_modules", browser)}`
    if (!manifest.dsh.profile.bundles.includes(browser)) manifest.dsh.profile.bundles.push(browser)
    manifest.dsh.profile.optionalBrowserMigration = 1
    // Keep first creation identical to later restarts (including dev attach/detach).
    Object.assign(manifest, managedDshProfileManifest(paths.surface, manifest))
  }
  await Promise.all([
    writeFile(
      paths.profileManifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    ),
    existsSync(paths.profilePatch)
      ? Promise.resolve()
      : writeFile(paths.profilePatch, "[]\n", { encoding: "utf8", mode: 0o600 }),
    writeFile(
      paths.profileManagedPatch,
      paths.surface === "headless"
        ? "# One-shot runs do not need filesystem watchers.\n- id: skill-filesystem\n  config:\n    watch: false\n"
        : "[]\n",
      { encoding: "utf8", mode: 0o600 },
    ),
    existsSync(paths.profileWorkspace)
      ? Promise.resolve()
      : writeFile(
          paths.profileWorkspace,
          "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n",
          { encoding: "utf8", mode: 0o600 },
        ),
  ])
}

export { AMIBA_DSH_BUNDLES }

export * from "./plugin-development.js"
export * from "./package-resolution.js"

/** Keep desktop, CLI and plugin commands on the managed Node/toolchain. */
export function managedDshEnvironment(paths: Pick<ManagedDshPaths, "home" | "agentsHome" | "runtimeAppBinDir" | "runtimeBinDir">, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Windows environment keys are case-insensitive; duplicate Path/PATH keys
  // can cause spawn to pass the inherited path instead of our managed one.
  const result = { ...env }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === "PATH")
  const inheritedPath = env.PATH ?? (pathKey ? env[pathKey] : undefined) ?? ""
  if (process.platform === "win32") {
    for (const key of Object.keys(result)) if (key.toUpperCase() === "PATH") delete result[key]
  }
  return {
    ...result,
    DSH_HOME: paths.home,
    DSH_AGENTS_HOME: paths.agentsHome,
    PATH: [paths.runtimeAppBinDir, paths.runtimeBinDir, inheritedPath].join(path.delimiter),
  }
}
