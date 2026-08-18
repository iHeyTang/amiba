import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

import type {
  AmibaDshPluginMutationResult,
  AmibaDshProfilePlugin,
} from "@amiba/extension-sdk";

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

interface ProfileManifest {
  dependencies?: Record<string, string>;
  dsh?: { profile?: { bundles?: string[] } };
}

export interface DshPluginCommandResult {
  stdout: string;
  stderr: string;
}

export interface DshProfilePluginRuntime {
  ensureManagedProfile(): Promise<void>;
  ensureStarted(): Promise<unknown>;
  stop(): Promise<void>;
}

export interface DshProfilePluginPaths {
  profileName: string;
  root: string;
  home: string;
  agentsHome: string;
  runtimeBinDir: string;
  runtimeAppBinDir: string;
  node: string;
  entrypoint: string;
  profileDir: string;
  profileManifest: string;
}

export interface DshProfilePluginManagerOptions {
  paths: DshProfilePluginPaths;
  runtime: DshProfilePluginRuntime;
  runCommand?: (
    args: readonly string[],
    paths: DshProfilePluginPaths,
  ) => Promise<DshPluginCommandResult>;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readProfileManifest(filename: string): Promise<ProfileManifest> {
  const parsed = JSON.parse(await readFile(filename, "utf8")) as unknown;
  const root = object(parsed);
  if (!root) throw new Error("DSH profile package.json must contain an object.");
  const dependencies = object(root.dependencies);
  if (
    dependencies &&
    Object.values(dependencies).some((value) => typeof value !== "string")
  ) {
    throw new Error("DSH profile dependencies must be string package specs.");
  }
  const dsh = object(root.dsh);
  const profile = object(dsh?.profile);
  const bundles = profile?.bundles;
  if (
    bundles !== undefined &&
    (!Array.isArray(bundles) || bundles.some((value) => typeof value !== "string"))
  ) {
    throw new Error("DSH profile bundles must be a string array.");
  }
  return {
    dependencies: (dependencies ?? {}) as Record<string, string>,
    dsh: { profile: { bundles: (bundles ?? []) as string[] } },
  };
}

function packageDirectory(profileDir: string, packageName: string): string {
  return path.join(profileDir, "node_modules", ...packageName.split("/"));
}

async function inspectProfilePackage(
  profileDir: string,
  packageName: string,
  requestedSpec: string,
  configuredBundles: ReadonlySet<string>,
): Promise<AmibaDshProfilePlugin> {
  const directory = packageDirectory(profileDir, packageName);
  let installed: Record<string, unknown> | null = null;
  try {
    installed = object(
      JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as unknown,
    );
  } catch {
    // A broken dependency stays visible in the management UI and fails the
    // mutation validator below instead of disappearing from the profile.
  }
  const installedDsh = object(installed?.dsh);
  const bundle = object(installedDsh?.bundle);
  return {
    packageName,
    requestedSpec,
    ...(typeof installed?.version === "string"
      ? { version: installed.version }
      : {}),
    bundle:
      configuredBundles.has(packageName) && typeof bundle?.patch === "string",
  };
}

export async function listDshProfilePlugins(paths: {
  profileDir: string;
  profileManifest: string;
}): Promise<readonly AmibaDshProfilePlugin[]> {
  const manifest = await readProfileManifest(paths.profileManifest);
  const bundles = new Set(manifest.dsh?.profile?.bundles ?? []);
  const dependencies = manifest.dependencies ?? {};
  return Promise.all(
    Object.entries(dependencies)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageName, requestedSpec]) =>
        inspectProfilePackage(
          paths.profileDir,
          packageName,
          requestedSpec,
          bundles,
        ),
      ),
  );
}

export function assertDshPackageName(packageName: string): string {
  const normalized = packageName.trim();
  if (!PACKAGE_NAME_PATTERN.test(normalized)) {
    throw new Error(`Invalid npm package name: ${packageName}`);
  }
  return normalized;
}

/** Resolve the actual package name from one registry-only pnpm add spec. */
export function registryPackageName(spec: string): string {
  const normalized = spec.trim();
  if (
    !normalized ||
    normalized.startsWith("-") ||
    /\s|[\\]/u.test(normalized) ||
    /^(?:file|link|workspace|git|github|https?):/iu.test(normalized)
  ) {
    throw new Error("Enter an npm registry package name, optionally with a version.");
  }
  let packageName: string;
  let version = "";
  if (normalized.startsWith("@")) {
    const slash = normalized.indexOf("/");
    const separator = normalized.indexOf("@", slash + 1);
    packageName = separator < 0 ? normalized : normalized.slice(0, separator);
    version = separator < 0 ? "" : normalized.slice(separator + 1);
  } else {
    const separator = normalized.indexOf("@");
    packageName = separator < 0 ? normalized : normalized.slice(0, separator);
    version = separator < 0 ? "" : normalized.slice(separator + 1);
  }
  assertDshPackageName(packageName);
  if (version && !/^[a-z0-9*^~<>=._+|-]+$/iu.test(version)) {
    throw new Error(`Unsupported registry version selector: ${version}`);
  }
  return packageName;
}

export function isRegistryDependencySpec(spec: string): boolean {
  const normalized = spec.trim();
  return Boolean(normalized) &&
    !/^(?:file:|link:|workspace:|git(?:\+[^:]+)?:|github:|https?:|\.{0,2}[/\\]|[/\\])/iu.test(
      normalized,
    );
}

async function assertInstalledBundle(
  paths: DshProfilePluginPaths,
  packageName: string,
): Promise<void> {
  const manifest = await readProfileManifest(paths.profileManifest);
  if (!(packageName in (manifest.dependencies ?? {}))) {
    throw new Error(`${packageName} was not written to the DSH profile dependencies.`);
  }
  if (!(manifest.dsh?.profile?.bundles ?? []).includes(packageName)) {
    throw new Error(`${packageName} does not declare a DSH bundle and was not activated.`);
  }
  const directory = packageDirectory(paths.profileDir, packageName);
  const installed = object(
    JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as unknown,
  );
  if (!installed || installed.name !== packageName) {
    throw new Error(`Installed package identity does not match ${packageName}.`);
  }
  const patchValue = object(object(installed.dsh)?.bundle)?.patch;
  if (typeof patchValue !== "string" || !patchValue.trim()) {
    throw new Error(`${packageName} has no dsh.bundle.patch declaration.`);
  }
  const patchPath = path.resolve(directory, patchValue);
  const relative = path.relative(directory, patchPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${packageName} declares a bundle patch outside its package.`);
  }
  const patchStat = await stat(patchPath);
  if (!patchStat.isFile()) {
    throw new Error(`${packageName} bundle patch is not a file.`);
  }
}

function appendBounded(current: string, chunk: Buffer | string): string {
  return `${current}${String(chunk)}`.slice(-MAX_COMMAND_OUTPUT_BYTES);
}

export async function runManagedDshPluginCommand(
  args: readonly string[],
  paths: DshProfilePluginPaths,
): Promise<DshPluginCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(paths.node, [paths.entrypoint, ...args], {
      cwd: path.dirname(paths.root),
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        DSH_HOME: paths.home,
        DSH_AGENTS_HOME: paths.agentsHome,
        PATH: [
          paths.runtimeAppBinDir,
          paths.runtimeBinDir,
          process.env.PATH ?? "",
        ].join(path.delimiter),
        COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
        PNPM_HOME: paths.runtimeAppBinDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    let forceKill: NodeJS.Timeout | undefined;
    let timedOut = false;
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
    };
    const terminate = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // Fall through when the process group has already gone away.
        }
      }
      child.kill(signal);
    };
    child.once("error", (error) => {
      clearTimers();
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimers();
      if (timedOut) {
        reject(new Error(`DSH plugin command exceeded ${COMMAND_TIMEOUT_MS}ms.`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `DSH plugin command failed (code=${code ?? "null"}, signal=${signal ?? "none"}).\n${stdout}${stderr}`,
        ),
      );
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      forceKill = setTimeout(() => terminate("SIGKILL"), 5_000);
      forceKill.unref();
    }, COMMAND_TIMEOUT_MS);
    timeout.unref();
  });
}

async function sha256(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Transactional desktop boundary around DSH's official profile plugin command.
 * No plugin registry is stored here: the profile manifest and Loader inventory
 * remain the two authoritative views (desired composition and live fibers).
 */
export class DshProfilePluginManager {
  private operation: Promise<unknown> = Promise.resolve();
  private readonly paths: DshProfilePluginPaths;
  private readonly runtime: DshProfilePluginRuntime;
  private readonly runCommand: NonNullable<DshProfilePluginManagerOptions["runCommand"]>;

  constructor(options: DshProfilePluginManagerOptions) {
    this.paths = options.paths;
    this.runtime = options.runtime;
    this.runCommand = options.runCommand ?? runManagedDshPluginCommand;
  }

  private exclusive<T>(callback: () => Promise<T>): Promise<T> {
    const next = this.operation.then(callback, callback);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }

  async list(): Promise<{ packages: readonly AmibaDshProfilePlugin[] }> {
    await this.runtime.ensureManagedProfile();
    return { packages: await listDshProfilePlugins(this.paths) };
  }

  installRegistry(spec: string): Promise<AmibaDshPluginMutationResult> {
    const packageName = registryPackageName(spec);
    return this.exclusive(() =>
      this.mutate("install", packageName, [
        "plugin",
        "--profile",
        this.paths.profileName,
        "add",
        "-w",
        "--save-exact",
        spec.trim(),
      ]),
    );
  }

  async installArchive(filename: string): Promise<AmibaDshPluginMutationResult> {
    const archivePath = path.resolve(filename);
    if (!path.isAbsolute(filename) || !/\.tgz$/iu.test(archivePath)) {
      throw new Error("Select a .tgz DSH plugin package.");
    }
    const archiveStat = await stat(archivePath);
    if (!archiveStat.isFile() || archiveStat.size > MAX_ARCHIVE_BYTES) {
      throw new Error("The selected DSH plugin archive is invalid or too large.");
    }
    return this.exclusive(async () => {
      await this.runtime.ensureManagedProfile();
      const before = await readProfileManifest(this.paths.profileManifest);
      const archiveDir = path.join(this.paths.profileDir, ".amiba", "plugin-archives");
      const digest = await sha256(archivePath);
      const managedArchive = path.join(archiveDir, `${digest}.tgz`);
      const result = await this.mutate(
        "install",
        null,
        [
          "plugin",
          "--profile",
          this.paths.profileName,
          "add",
          "-w",
          "--save-exact",
          `file:${managedArchive}`,
        ],
        async () => {
          await mkdir(archiveDir, { recursive: true });
          if (!existsSync(managedArchive)) await copyFile(archivePath, managedArchive);
        },
        before.dependencies ?? {},
      );
      return result;
    });
  }

  remove(packageName: string): Promise<AmibaDshPluginMutationResult> {
    const normalized = assertDshPackageName(packageName);
    return this.exclusive(async () => {
      const current = await this.list();
      if (!current.packages.some((item) => item.packageName === normalized)) {
        throw new Error(`${normalized} is not installed in the active DSH profile.`);
      }
      return this.mutate("remove", normalized, [
        "plugin",
        "--profile",
        this.paths.profileName,
        "remove",
        "-w",
        normalized,
      ]);
    });
  }

  update(packageName: string): Promise<AmibaDshPluginMutationResult> {
    const normalized = assertDshPackageName(packageName);
    return this.exclusive(async () => {
      const current = await this.list();
      const installed = current.packages.find(
        (item) => item.packageName === normalized,
      );
      if (!installed) {
        throw new Error(`${normalized} is not installed in the active DSH profile.`);
      }
      if (!isRegistryDependencySpec(installed.requestedSpec)) {
        throw new Error(
          `${normalized} was installed from a local or non-registry source; select a new .tgz to update it.`,
        );
      }
      return this.mutate("update", normalized, [
        "plugin",
        "--profile",
        this.paths.profileName,
        "update",
        "-w",
        "--latest",
        normalized,
      ]);
    });
  }

  private async mutate(
    action: AmibaDshPluginMutationResult["action"],
    expectedPackageName: string | null,
    command: readonly string[],
    prepare?: () => Promise<void>,
    dependenciesBeforeOverride?: Record<string, string>,
  ): Promise<AmibaDshPluginMutationResult> {
    await this.runtime.ensureManagedProfile();
    const before = await readProfileManifest(this.paths.profileManifest);
    const beforeDependencies =
      dependenciesBeforeOverride ?? before.dependencies ?? {};
    const snapshot = `${this.paths.profileDir}.rollback-${randomUUID()}`;
    const failed = `${this.paths.profileDir}.failed-${randomUUID()}`;
    await this.runtime.stop();
    try {
      await cp(this.paths.profileDir, snapshot, {
        recursive: true,
        dereference: false,
        preserveTimestamps: true,
      });
    } catch (error) {
      try {
        await this.runtime.ensureStarted();
      } catch (restartError) {
        throw new AggregateError(
          [error, restartError],
          "DSH profile snapshot failed and the previous runtime could not restart.",
        );
      }
      throw error;
    }
    try {
      await prepare?.();
      await this.runCommand(command, this.paths);
      await this.runtime.ensureManagedProfile();
      const after = await readProfileManifest(this.paths.profileManifest);
      const afterDependencies = after.dependencies ?? {};
      let packageName = expectedPackageName;
      if (!packageName) {
        const changed = Object.keys(afterDependencies).filter(
          (name) => afterDependencies[name] !== beforeDependencies[name],
        );
        if (changed.length !== 1) {
          throw new Error(
            `The archive must add exactly one direct DSH bundle dependency; changed: ${changed.join(", ") || "none"}.`,
          );
        }
        packageName = changed[0]!;
      }
      if (action === "remove") {
        if (packageName in afterDependencies) {
          throw new Error(`${packageName} remains in the DSH profile after removal.`);
        }
        if ((after.dsh?.profile?.bundles ?? []).includes(packageName)) {
          throw new Error(`${packageName} remains in the DSH bundle stack after removal.`);
        }
      } else {
        await assertInstalledBundle(this.paths, packageName);
      }

      // Compose the exact post-mutation tree before making it the live runtime.
      await this.runCommand(
        ["--profile", this.paths.profileName, "--dump-config"],
        this.paths,
      );
      await this.runtime.ensureStarted();
      await rm(snapshot, { recursive: true, force: true });
      return {
        action,
        packageName,
        packages: await listDshProfilePlugins(this.paths),
      };
    } catch (error) {
      let rollbackError: unknown;
      try {
        await this.runtime.stop();
        if (existsSync(this.paths.profileDir)) {
          await rename(this.paths.profileDir, failed);
        }
        await rename(snapshot, this.paths.profileDir);
        await rm(failed, { recursive: true, force: true });
        await this.runtime.ensureStarted();
      } catch (cause) {
        rollbackError = cause;
      }
      if (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "DSH plugin mutation and profile rollback both failed.",
        );
      }
      throw error;
    }
  }
}
