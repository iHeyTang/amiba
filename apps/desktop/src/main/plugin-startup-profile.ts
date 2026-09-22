import { execFile } from "node:child_process";
import { mkdir, writeFile, symlink, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { managedDshProfileManifest, type ManagedDshPaths } from "@amiba/app-runtime/dsh-runtime";

/** A separate composition, anchored at shipped packages; never rewrite the installed profile. */
export async function prepareSafeProfile(paths: ManagedDshPaths): Promise<{ name: string; launcher: string }> {
  const name = `${paths.profileName}-safe`;
  const directory = path.join(paths.home, "profiles", name);
  await mkdir(directory, { recursive: true });
  const manifest = managedDshProfileManifest(paths.surface) as any;
  // The browser provider ships with Amiba, although it is removable in normal mode.
  manifest.dsh.profile.bundles.splice(2, 0, "@amiba/dsh-plugin-browser-provider-electron");
  manifest.dependencies = Object.fromEntries(manifest.dsh.profile.bundles.map((name: string) => [name, `link:${path.join(paths.runtimeDir, "app/node_modules", name)}`]));
  const modules = path.join(directory, "node_modules");
  if (!await lstat(modules).catch(() => null)) await symlink(path.join(paths.runtimeDir, "app/node_modules"), modules, process.platform === "win32" ? "junction" : "dir");
  await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
  await writeFile(path.join(directory, "cordis.yml"), "[]\n");
  const launcher = path.join(directory, "launch.mjs");
  // Use public DSH boot APIs rather than the CLI's private chunk names. No
  // profile/home user overlays are read; session/settings storage keeps DSH_HOME.
  await writeFile(launcher, `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(${JSON.stringify(paths.entrypoint)});
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot, loadProfile, installFailLoud, loadLayeredEnv } = await load('@deepseek-ai/dsh-app-boot');
const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
const { DSH_LAUNCH_ENVIRONMENT_KEY } = await load('@deepseek-ai/dsh-launch-environment');
const { installProxyFromEnvironment } = await load('@deepseek-ai/dsh-http-proxy');
const environment = loadLayeredEnv('amiba');
const disposeProxy = await installProxyFromEnvironment(environment, message => console.error(message));
const profile = loadProfile('amiba', ${JSON.stringify(name)}, ${JSON.stringify(paths.entrypoint)}, ${JSON.stringify(paths.home)}, { userLayer: false });
let ctx, ready = false, closing = false;
const listeners = new Set();
const shutdown = async code => {
  if (closing) return process.exit(code);
  closing = true;
  const timer = setTimeout(() => process.exit(code), 5000);
  try { await ctx?.fiber.dispose(); await disposeProxy(); } finally { clearTimeout(timer); process.exit(code); }
};
process.on('SIGTERM', () => void shutdown(0));
process.on('SIGINT', () => void shutdown(130));
installFailLoud('amiba', process, async () => { await ctx?.fiber.dispose(); });
const patches = profile.layers.flatMap(layer => layer.patches);
if (process.env.DSH_TELEMETRY_DISABLED) patches.push({ id: 'session-telemetry-otel', disabled: true });
ctx = await boot('amiba', ${JSON.stringify(path.join(directory, "cordis.yml"))}, patches, host => {
  ctx = host;
  host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, environment);
  provideCmdline(host, { args: process.argv.slice(2), exit: code => void shutdown(code), ready: {
    onReady(listener) { if (ready) listener(); else listeners.add(listener); return () => listeners.delete(listener); }
  }});
}, pathToFileURL(${JSON.stringify(paths.entrypoint)}).href);
ready = true;
for (const listener of listeners) listener();
listeners.clear();
`);
  return { name, launcher };
}

/** Compose metadata in a bounded child. This imports the trusted composer, not plugin entrypoints. */
export async function countUserStartupPlugins(paths: ManagedDshPaths, safeName: string): Promise<number> {
  const { stdout } = await promisify(execFile)(paths.node, ["--input-type=module", "--eval", `
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [entry, home, normalName, safeName] = process.argv.slice(1);
const require = createRequire(entry);
const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const safe = boot.loadProfile('amiba', safeName, entry, home, { userLayer: false });
const normal = boot.loadProfile('amiba', normalName, entry, home);
const flatten = (rows, out = []) => { for (const row of rows) { if (row.disabled) continue; if (row.name) out.push(row.name); if (Array.isArray(row.config)) flatten(row.config, out); } return out; };
const builtin = new Set(flatten(boot.composeEntries([safe.layers.flatMap(x => x.patches)])));
const rows = boot.composeEntries([normal.layers.flatMap(x => x.patches), normal.patches, boot.loadOptionalPatches('amiba', path.join(home, 'cordis.patch.yml')) ?? []]);
process.stdout.write(JSON.stringify(new Set(flatten(rows).filter(name => !builtin.has(name))).size));
`, paths.entrypoint, paths.home, paths.profileName, safeName], { timeout: 15_000, maxBuffer: 1024 * 1024 });
  const count = JSON.parse(stdout);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid plugin startup inventory");
  return count;
}
