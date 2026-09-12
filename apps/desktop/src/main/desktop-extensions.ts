import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  DesktopExtension,
  DesktopExtensionContext,
  DesktopExtensionModule,
} from "@amiba/extension-sdk";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

/** Follow the installed dependency graph, including bundle-owned plugins. */
export function resolveDesktopExtension(
  profileManifest: string,
  packageName: string,
): string {
  if (!PACKAGE_NAME.test(packageName))
    throw new Error("Invalid desktop extension package name");
  const queue = [profileManifest];
  const seen = new Set<string>();
  while (queue.length) {
    const filename = realpathSync(queue.shift()!);
    if (seen.has(filename)) continue;
    seen.add(filename);
    const manifest = JSON.parse(readFileSync(filename, "utf8"));
    if (manifest.name === packageName) {
      const entry = manifest.dsh?.native;
      if (typeof entry !== "string" || !entry.endsWith(".cjs"))
        throw new Error(
          `${packageName} must declare a bundled dsh.native .cjs entry`,
        );
      const directory = path.dirname(filename);
      const resolved = realpathSync(path.resolve(directory, entry));
      const relative = path.relative(directory, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Native entry escapes its installed package");
      return resolved;
    }
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      if (!PACKAGE_NAME.test(name)) continue;
      const candidate = path.join(
        path.dirname(filename),
        "node_modules",
        ...name.split("/"),
        "package.json",
      );
      try {
        queue.push(
          realpathSync(createRequire(filename).resolve(`${name}/package.json`)),
        );
      } catch {
        try {
          queue.push(realpathSync(candidate));
        } catch {
          /* Not installed or not exported. */
        }
      }
    }
  }
  throw new Error(
    `Desktop extension is not installed in this profile: ${packageName}`,
  );
}

interface LoadedExtension {
  packageName: string;
  instanceId: string;
  lease: string;
  extension: DesktopExtension;
}
export class DesktopExtensionHost {
  private readonly entries = new Map<string, LoadedExtension>();
  private readonly leases = new Map<string, LoadedExtension>();
  private readonly profileManifest: () => string;
  private readonly context: DesktopExtensionContext;
  private readonly load: (filename: string) => DesktopExtensionModule;
  constructor(options: {
    profileManifest(): string;
    context: DesktopExtensionContext;
    load?: (filename: string) => DesktopExtensionModule;
  }) {
    this.profileManifest = options.profileManifest;
    this.context = options.context;
    this.load =
      options.load ??
      ((filename) => {
        const require = createRequire(filename);
        // Entries must be single bundled modules so replacement never reuses stale children.
        delete require.cache[filename];
        return require(filename);
      });
  }
  attach(packageName: string, instanceId: string): string {
    if (
      typeof instanceId !== "string" ||
      !instanceId ||
      instanceId.length > 160
    )
      throw new Error("Invalid extension instance");
    const existing = this.entries.get(packageName);
    if (existing?.instanceId === instanceId) return existing.lease;
    if (existing)
      throw new Error(`Desktop extension already active: ${packageName}`);
    const filename = resolveDesktopExtension(
      this.profileManifest(),
      packageName,
    );
    const module = this.load(filename);
    if (typeof module.create !== "function")
      throw new Error("Native extension has no create function");
    const lease = randomUUID();
    const extension = module.create({
      ...this.context,
      emit: (ownerId, event, payload) => {
        if (this.leases.has(lease))
          this.context.emit(ownerId, "native-extension:event", {
            lease,
            event,
            payload,
          });
      },
    });
    if (
      !extension ||
      typeof extension.call !== "function" ||
      typeof extension.rendererCall !== "function" ||
      typeof extension.dispose !== "function"
    ) {
      extension?.dispose?.();
      throw new Error("Invalid native extension lifecycle");
    }
    const entry = { packageName, instanceId, lease, extension };
    this.entries.set(packageName, entry);
    this.leases.set(lease, entry);
    return lease;
  }
  connect(packageName: string): string {
    const entry = this.entries.get(packageName);
    if (!entry)
      throw new Error(`Desktop extension is not active: ${packageName}`);
    return entry.lease;
  }
  detachInstance(packageName: string, instanceId: string): void {
    const entry = this.entries.get(packageName);
    if (entry?.instanceId === instanceId) this.detach(entry.lease);
  }
  detach(lease: string): void {
    const entry = this.leases.get(lease);
    if (!entry) return;
    this.leases.delete(lease);
    this.entries.delete(entry.packageName);
    entry.extension.dispose();
  }
  reset(): void {
    const entries = [...this.leases.values()];
    this.entries.clear();
    this.leases.clear();
    const errors: unknown[] = [];
    for (const entry of entries) {
      try {
        entry.extension.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "Native extension cleanup failed");
  }
  allowsPartition(partition: string): boolean {
    return [...this.entries.values()].some((entry) =>
      entry.extension.partitions?.includes(partition),
    );
  }
  async call(
    lease: string,
    method: string,
    args: Record<string, unknown>,
    context: { sessionId?: string },
  ): Promise<unknown> {
    const entry = this.requireLease(lease);
    const result = await entry.extension.call(method, args, context);
    this.requireLease(lease);
    return result;
  }
  async rendererCall(
    ownerId: number,
    lease: string,
    method: string,
    args: unknown,
  ): Promise<unknown> {
    const entry = this.requireLease(lease);
    const result = await entry.extension.rendererCall(ownerId, method, args);
    this.requireLease(lease);
    return result;
  }
  private requireLease(lease: string): LoadedExtension {
    const entry = this.leases.get(lease);
    if (!entry) throw new Error("Desktop extension was unloaded");
    return entry;
  }
}
