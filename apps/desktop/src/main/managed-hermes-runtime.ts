import { createHash } from "node:crypto";
import path from "node:path";
import runtimeManifest from "../../hermes-runtime-manifest.json" with { type: "json" };

/**
 * Hermes runtime release consumed by Amiba Desktop.
 *
 * Hermes is distributed as source, so an Amiba release turns one immutable
 * upstream commit into a platform-specific, relocatable runtime bundle. The
 * the application executes that bundle directly from its resources directory;
 * the user's machine never clones Hermes or resolves Python/Node dependencies.
 */
export interface ManagedHermesPatch {
  id: string;
  file: string;
  sha256: string;
  verifier: string;
  verifierSha256: string;
}

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
  patches: readonly Readonly<ManagedHermesPatch>[];
  backplanePort: number;
  gatewayPort: number;
}

export const MANAGED_HERMES_RUNTIME: Readonly<ManagedHermesRuntimeManifest> =
  Object.freeze({
    ...runtimeManifest,
    patches: Object.freeze(
      runtimeManifest.patches.map((patch) => Object.freeze({ ...patch })),
    ),
  });

export function assertValidManagedHermesRuntimeManifest(
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): void {
  if (manifest.schemaVersion !== 3) {
    throw new Error(
      `Unsupported Hermes runtime manifest schema: ${manifest.schemaVersion}`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.commit)) {
    throw new Error("Managed Hermes commit must be a full 40-character SHA");
  }
  if (
    !Number.isInteger(manifest.bundleSchemaVersion) ||
    manifest.bundleSchemaVersion < 1
  ) {
    throw new Error("Managed Hermes bundle schema is invalid");
  }
  if (!/^3\.11\.\d+$/.test(manifest.pythonVersion)) {
    throw new Error(
      "Managed Hermes Python version must pin a 3.11 patch release",
    );
  }
  if (!/^22\.\d+\.\d+$/.test(manifest.nodeVersion)) {
    throw new Error(
      "Managed Hermes Node version must pin a 22.x patch release",
    );
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.playwrightVersion)) {
    throw new Error(
      "Managed Hermes Playwright version must pin a patch release",
    );
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(manifest.repository)) {
    throw new Error("Managed Hermes repository must be an owner/name pair");
  }
  if (!Array.isArray(manifest.patches)) {
    throw new Error("Managed Hermes runtime patches must be an array");
  }
  const patchIds = new Set<string>();
  for (const patch of manifest.patches) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(patch.id) || patchIds.has(patch.id)) {
      throw new Error(
        `Managed Hermes patch id is invalid or duplicated: ${patch.id}`,
      );
    }
    patchIds.add(patch.id);
    for (const [field, value] of [
      ["file", patch.file],
      ["verifier", patch.verifier],
    ] as const) {
      const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
      if (
        !value ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        path.posix.isAbsolute(normalized) ||
        path.win32.isAbsolute(value)
      ) {
        throw new Error(
          `Managed Hermes patch ${patch.id} has an invalid ${field}`,
        );
      }
    }
    if (!/^[0-9a-f]{64}$/.test(patch.sha256)) {
      throw new Error(`Managed Hermes patch ${patch.id} has an invalid sha256`);
    }
    if (!/^[0-9a-f]{64}$/.test(patch.verifierSha256)) {
      throw new Error(
        `Managed Hermes patch ${patch.id} has an invalid verifierSha256`,
      );
    }
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

export function managedHermesPatchSetHash(
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): string {
  const hash = createHash("sha256");
  for (const patch of manifest.patches) {
    for (const value of [
      patch.id,
      patch.file,
      patch.sha256,
      patch.verifier,
      patch.verifierSha256,
    ]) {
      hash.update(value);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

export interface ManagedHermesPaths {
  root: string;
  hermesHome: string;
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
  runtimeDir: string,
  platform: NodeJS.Platform = process.platform,
  manifest: Readonly<ManagedHermesRuntimeManifest> = MANAGED_HERMES_RUNTIME,
): ManagedHermesPaths {
  assertValidManagedHermesRuntimeManifest(manifest);
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(userDataDir)) {
    throw new Error("Amiba userData directory must be absolute");
  }
  if (!pathApi.isAbsolute(runtimeDir)) {
    throw new Error("Amiba bundled Runtime directory must be absolute");
  }

  const root = pathApi.join(userDataDir, "hermes");
  const normalizedRuntimeDir = pathApi.normalize(runtimeDir);
  const installDir = pathApi.join(normalizedRuntimeDir, "hermes-agent");
  const python =
    platform === "win32"
      ? pathApi.join(normalizedRuntimeDir, "python", "python.exe")
      : pathApi.join(
          normalizedRuntimeDir,
          "python",
          "bin",
          `python${manifest.pythonVersion.split(".").slice(0, 2).join(".")}`,
        );
  return {
    root,
    hermesHome: pathApi.join(root, "home"),
    runtimeDir: normalizedRuntimeDir,
    installDir,
    entrypoint: pathApi.join(installDir, "hermes"),
    // The renderer treats this as an opaque runtime handle. Main invokes the
    // checked-in Hermes entrypoint with this portable interpreter, avoiding
    // build-machine paths embedded in generated console scripts.
    binary: python,
    python,
    nodeBinDir:
      platform === "win32"
        ? pathApi.join(normalizedRuntimeDir, "node")
        : pathApi.join(normalizedRuntimeDir, "node", "bin"),
    browsersDir: pathApi.join(normalizedRuntimeDir, "browsers"),
    bundleMarker: pathApi.join(normalizedRuntimeDir, "runtime-manifest.json"),
  };
}

export interface BundledHermesRuntimeMarker {
  schemaVersion: number;
  hermesCommit: string;
  hermesVersion: string;
  pythonVersion: string;
  nodeVersion: string;
  playwrightVersion: string;
  hermesPatchSetHash: string;
  platform: NodeJS.Platform;
  arch: string;
  buildFlavor?: "development" | "release";
  sourceRevision?: string;
  backplaneVersion?: string;
  backplaneSourceHash?: string;
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
    hermesPatchSetHash: managedHermesPatchSetHash(manifest),
    platform,
    arch,
  };
}

export function bundledHermesRuntimeArtifactsMatch(
  left: Readonly<BundledHermesRuntimeMarker>,
  right: Readonly<BundledHermesRuntimeMarker>,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.hermesCommit === right.hermesCommit &&
    left.hermesVersion === right.hermesVersion &&
    left.pythonVersion === right.pythonVersion &&
    left.nodeVersion === right.nodeVersion &&
    left.playwrightVersion === right.playwrightVersion &&
    left.hermesPatchSetHash === right.hermesPatchSetHash &&
    left.platform === right.platform &&
    left.arch === right.arch &&
    left.buildFlavor === right.buildFlavor &&
    left.sourceRevision === right.sourceRevision
  );
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
    PYTHONDONTWRITEBYTECODE: "1",
    API_SERVER_ENABLED: "true",
    API_SERVER_PORT: String(manifest.gatewayPort),
    AMIBA_HERMES_GATEWAY_BASE: `http://127.0.0.1:${manifest.gatewayPort}`,
    AMIBA_MANAGED_HERMES: "1",
    AMIBA_MANAGED_HERMES_COMMIT: manifest.commit,
    AMIBA_MANAGED_HERMES_VERSION: manifest.version,
  };
}
