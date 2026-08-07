import path from "node:path";
import runtimeManifest from "../../hermes-runtime-manifest.json" with { type: "json" };

/**
 * Hermes runtime release consumed by Amiba Desktop.
 *
 * Hermes is distributed as source, so an Amiba release turns one immutable
 * upstream commit into a platform-specific, relocatable runtime bundle. The
 * user's machine only copies that bundle into app-owned storage; it never
 * clones Hermes or resolves Python/Node dependencies.
 */
export interface ManagedHermesRuntimeManifest {
  schemaVersion: number;
  bundleSchemaVersion: number;
  repository: string;
  branch: string;
  commit: string;
  version: string;
  pythonVersion: string;
  nodeVersion: string;
  playwrightVersion: string;
  backplanePort: number;
  gatewayPort: number;
}

export const MANAGED_HERMES_RUNTIME: Readonly<ManagedHermesRuntimeManifest> = Object.freeze({
  ...runtimeManifest,
});

export function assertValidManagedHermesRuntimeManifest(
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): void {
  if (manifest.schemaVersion !== 2) {
    throw new Error(`Unsupported Hermes runtime manifest schema: ${manifest.schemaVersion}`);
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.commit)) {
    throw new Error("Managed Hermes commit must be a full 40-character SHA");
  }
  if (!Number.isInteger(manifest.bundleSchemaVersion) || manifest.bundleSchemaVersion < 1) {
    throw new Error("Managed Hermes bundle schema is invalid");
  }
  if (!/^3\.11\.\d+$/.test(manifest.pythonVersion)) {
    throw new Error("Managed Hermes Python version must pin a 3.11 patch release");
  }
  if (!/^22\.\d+\.\d+$/.test(manifest.nodeVersion)) {
    throw new Error("Managed Hermes Node version must pin a 22.x patch release");
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.playwrightVersion)) {
    throw new Error("Managed Hermes Playwright version must pin a patch release");
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository)) {
    throw new Error("Managed Hermes repository must be an owner/name pair");
  }
  for (const [name, port] of [
    ["backplanePort", manifest.backplanePort],
    ["gatewayPort", manifest.gatewayPort],
  ] as const) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error(`Managed Hermes ${name} is invalid: ${port}`);
    }
  }
  if (manifest.backplanePort === manifest.gatewayPort) {
    throw new Error("Managed Hermes gateway and backplane ports must differ");
  }
}

export interface ManagedHermesPaths {
  root: string;
  hermesHome: string;
  installerHome: string;
  runtimeDir: string;
  installDir: string;
  entrypoint: string;
  binary: string;
  python: string;
  nodeBinDir: string;
  browsersDir: string;
  bundleMarker: string;
}

export function resolveManagedHermesPaths(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform,
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): ManagedHermesPaths {
  assertValidManagedHermesRuntimeManifest(manifest);
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(userDataDir)) {
    throw new Error("Amiba userData directory must be absolute");
  }

  const root = pathApi.join(userDataDir, "hermes");
  const runtimeId = `${manifest.commit}-bundle-v${manifest.bundleSchemaVersion}`;
  const runtimeDir = pathApi.join(root, "runtimes", runtimeId);
  const installDir = pathApi.join(runtimeDir, "hermes-agent");
  const python =
    platform === "win32"
      ? pathApi.join(runtimeDir, "python", "python.exe")
      : pathApi.join(
          runtimeDir,
          "python",
          "bin",
          `python${manifest.pythonVersion.split(".").slice(0, 2).join(".")}`,
        );
  return {
    root,
    hermesHome: pathApi.join(root, "home"),
    // Keep installer caches and any incidental HOME-relative writes private.
    // The stage driver also deliberately skips the upstream "path" stage.
    installerHome: pathApi.join(root, "installer-home"),
    runtimeDir,
    installDir,
    entrypoint: pathApi.join(installDir, "hermes"),
    // The renderer treats this as an opaque runtime handle. Main invokes the
    // checked-in Hermes entrypoint with this portable interpreter, avoiding
    // build-machine paths embedded in generated console scripts.
    binary: python,
    python,
    nodeBinDir:
      platform === "win32"
        ? pathApi.join(runtimeDir, "node")
        : pathApi.join(runtimeDir, "node", "bin"),
    browsersDir: pathApi.join(runtimeDir, "browsers"),
    bundleMarker: pathApi.join(runtimeDir, "runtime-manifest.json"),
  };
}

export interface BundledHermesRuntimeMarker {
  schemaVersion: number;
  hermesCommit: string;
  hermesVersion: string;
  pythonVersion: string;
  nodeVersion: string;
  playwrightVersion: string;
  platform: NodeJS.Platform;
  arch: string;
}

export function expectedBundledHermesRuntimeMarker(
  platform: NodeJS.Platform = process.platform,
  arch = process.arch,
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): BundledHermesRuntimeMarker {
  return {
    schemaVersion: manifest.bundleSchemaVersion,
    hermesCommit: manifest.commit,
    hermesVersion: manifest.version,
    pythonVersion: manifest.pythonVersion,
    nodeVersion: manifest.nodeVersion,
    playwrightVersion: manifest.playwrightVersion,
    platform,
    arch,
  };
}

export function bundledHermesRuntimeDir(
  appPath: string,
  resourcesPath: string,
  packaged: boolean,
  override?: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (override) {
    if (!pathApi.isAbsolute(override)) {
      throw new Error("AMIBA_HERMES_RUNTIME_BUNDLE must be an absolute path");
    }
    return pathApi.normalize(override);
  }
  return packaged
    ? pathApi.join(resourcesPath, "resources", "hermes-runtime")
    : pathApi.join(appPath, "resources", "hermes-runtime");
}

export function buildManagedHermesEnvironment(
  sourceEnv: NodeJS.ProcessEnv,
  paths: ManagedHermesPaths,
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): NodeJS.ProcessEnv {
  return {
    ...sourceEnv,
    HERMES_HOME: paths.hermesHome,
    HERMES_INSTALL_DIR: paths.installDir,
    PLAYWRIGHT_BROWSERS_PATH: paths.browsersDir,
    API_SERVER_PORT: String(manifest.gatewayPort),
    AMIBA_HERMES_GATEWAY_BASE: `http://127.0.0.1:${manifest.gatewayPort}`,
    AMIBA_MANAGED_HERMES: "1",
    AMIBA_MANAGED_HERMES_COMMIT: manifest.commit,
    AMIBA_MANAGED_HERMES_VERSION: manifest.version,
  };
}
