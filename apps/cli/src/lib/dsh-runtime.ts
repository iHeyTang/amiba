import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import path from "node:path"
import {
  MANAGED_DSH_RUNTIME,
  ensureManagedDshProfile,
  resolveAmibaDshHome,
  resolveManagedDshRuntimeDir,
  resolveManagedDshRuntimePaths,
  verifyManagedDshRuntime,
  type AmibaDshSurface,
  type ManagedDshPaths,
} from "@amiba/app-runtime/dsh-runtime"

export { resolveAmibaDshHome } from "@amiba/app-runtime/dsh-runtime"

export interface AmibaDshProfile {
  surface: AmibaDshSurface
  name: string
  home: string
  directory: string
  manifest: string
  patch: string
  managedPatch: string
  runtime: ManagedDshPaths
}

export interface DshLaunchOptions {
  surface: AmibaDshSurface
  args: readonly string[]
  cwd?: string
  home?: string
  runtimeDir?: string
  env?: NodeJS.ProcessEnv
  spawn?: typeof spawnSync
}

export interface DshLaunchSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  profile: AmibaDshProfile
}

export async function ensureAmibaDshProfile(
  surface: AmibaDshSurface,
  options: {
    home?: string
    runtimeDir?: string
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<AmibaDshProfile> {
  const env = { ...process.env, ...options.env }
  const runtimeDir = resolveManagedDshRuntimeDir({
    explicit: options.runtimeDir,
    env,
  })
  try {
    verifyManagedDshRuntime({ runtimeDir })
  } catch (cause) {
    throw new Error(
      `Amiba managed DSH ${MANAGED_DSH_RUNTIME.version} is unavailable at ${runtimeDir}. ` +
        "Run pnpm runtime:prepare in a source checkout or reinstall the Amiba CLI distribution.",
      { cause },
    )
  }
  const runtime = resolveManagedDshRuntimePaths({
    surface,
    home: resolveAmibaDshHome(options.home, env),
    runtimeDir,
  })
  await ensureManagedDshProfile(runtime)
  return {
    surface,
    name: runtime.profileName,
    home: runtime.home,
    directory: runtime.profileDir,
    manifest: runtime.profileManifest,
    patch: runtime.profilePatch,
    managedPatch: runtime.profileManagedPatch,
    runtime,
  }
}

export async function createDshLaunchSpec(
  options: DshLaunchOptions,
): Promise<DshLaunchSpec> {
  const env = { ...process.env, ...options.env }
  const profile = await ensureAmibaDshProfile(options.surface, {
    home: options.home,
    runtimeDir: options.runtimeDir,
    env,
  })
  const managed = profile.runtime
  return {
    command: managed.node,
    args: [
      managed.entrypoint,
      "--profile",
      profile.name,
      "--patch",
      profile.managedPatch,
      ...options.args,
    ],
    cwd: path.resolve(options.cwd ?? process.cwd()),
    env: {
      ...env,
      DSH_HOME: profile.home,
      DSH_AGENTS_HOME: managed.agentsHome,
      PATH: [
        managed.runtimeAppBinDir,
        managed.runtimeBinDir,
        env.PATH ?? "",
      ].join(path.delimiter),
    },
    profile,
  }
}

export async function runDsh(
  options: DshLaunchOptions,
): Promise<SpawnSyncReturns<Buffer>> {
  const spec = await createDshLaunchSpec(options)
  return (options.spawn ?? spawnSync)(spec.command, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: "inherit",
    shell: false,
  })
}

export async function inspectAmibaDsh(options: {
  home?: string
  runtimeDir?: string
  env?: NodeJS.ProcessEnv
} = {}) {
  const env = { ...process.env, ...options.env }
  const runtimeDir = resolveManagedDshRuntimeDir({
    explicit: options.runtimeDir,
    env,
  })
  const marker = verifyManagedDshRuntime({ runtimeDir })
  const home = resolveAmibaDshHome(options.home, env)
  let headlessRuntime: ManagedDshPaths | undefined
  const surfaces = (["headless", "web", "desktop"] as const).map((surface) => {
    const runtime = resolveManagedDshRuntimePaths({
      surface,
      home,
      runtimeDir,
    })
    if (surface === "headless") headlessRuntime = runtime
    return {
      surface,
      profile: runtime.profileName,
      bundles: runtime.amibaBundleManifests,
    }
  })
  return {
    runtimeDir,
    node: headlessRuntime!.node,
    marker,
    home,
    surfaces,
  }
}
