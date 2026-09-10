import { createRequire } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Fiber } from "@deepseek-ai/cordis";
import { composeEntries, loadProfile } from "@deepseek-ai/dsh-app-boot";
import type { ToolSourceDescriptor } from "./provenance.js";

interface Entry { id: string; options: { id: string; name: string }; parent: { ctx: Context; tree?: { ctx: Context } }; }
const entryKey = Symbol.for("cordis.entry");

/** Read the app's shipped layers, excluding every user-installed bundle and patch. */
export function shippedEntries(ctx: Context, bundleNames: readonly string[]): Map<string, string> {
  const shippedBundles = new Set(bundleNames);
  const profileDir = resolve(fileURLToPath(ctx.root.baseUrl!));
  const require = createRequire(import.meta.url);
  const profile = loadProfile("amiba-tool-catalog", basename(profileDir), require.resolve("@deepseek-ai/dsh/package.json"), dirname(dirname(profileDir)), { userLayer: false });
  const result = new Map<string, string>();
  const visit = (rows: ReturnType<typeof composeEntries>) => {
    for (const row of rows) {
      result.set(row.id, row.name);
      if (row.group && Array.isArray(row.config)) visit(row.config);
    }
  };
  visit(composeEntries(profile.layers.filter(layer => shippedBundles.has(layer.packageName)).map(layer => layer.patches)));
  return result;
}

/** Classify the owning registration, not the viewer or a tool-name prefix. */
export function registrationSource(owner: Context, shipped: ReadonlyMap<string, string>, preset?: { id: string; name?: string; trust: "system" | "user" }): ToolSourceDescriptor {
  const seen = new Set<Fiber>();
  let fiber: Fiber | undefined = owner.fiber;
  let dynamic = false;
  while (fiber && !seen.has(fiber)) {
    seen.add(fiber);
    // DSH's explicit boundary for code authored with cordis_define/cordis_run.
    if (fiber.runtime?.name === "cordis-dynamic") dynamic = true;
    fiber = fiber.parent?.fiber;
  }
  const entry = (owner as unknown as Record<symbol, Entry | undefined>)[entryKey];
  let rootEntry = entry;
  const visited = new Set<Entry>();
  while (rootEntry && !visited.has(rootEntry)) {
    visited.add(rootEntry);
    const parentContext = rootEntry.parent.tree?.ctx ?? rootEntry.parent.ctx;
    const parent = (parentContext as unknown as Record<symbol, Entry | undefined>)[entryKey];
    if (!parent || parent === rootEntry) break;
    // The outer boot include is infrastructure, not a shipped plugin row.
    const grandparentContext = parent.parent.tree?.ctx ?? parent.parent.ctx;
    if (parent.options.name === "cordis:include" && !(grandparentContext as unknown as Record<symbol, Entry | undefined>)[entryKey]) break;
    rootEntry = parent;
  }
  const builtin = !dynamic && (preset ? preset.trust === "system" : !!rootEntry && shipped.get(rootEntry.options.id) === rootEntry.options.name);
  return {
    kind: "dsh-plugin",
    distribution: builtin ? "builtin" : "user",
    id: dynamic ? `dynamic:${owner.fiber.uid}` : entry?.id ?? `plugin:${owner.fiber.uid}`,
    name: preset?.name ?? owner.fiber.name,
    packageName: entry?.options.name,
    loadMode: "plugin",
    executionTarget: "dsh-runtime",
    dynamic,
  };
}
