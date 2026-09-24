import { createHash, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { access, copyFile, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { ManagedDshPaths } from "./index.js"
import { resolveInstalledPackageDirectory } from "./package-resolution.js"

export const DESKTOP_DEVELOPMENT_FILE = "amiba-desktop-development.json"
export interface DesktopDevelopmentEndpoint { version: 1; url: string; token: string; pid: number }
export interface DevelopmentProject { directory: string; name: string; manifest: Record<string, any> }

export async function readDevelopmentProject(directory: string): Promise<DevelopmentProject> {
  directory = await realpath(directory)
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"))
  if (typeof manifest.name !== "string" || !/^(?:@[a-z0-9._-]+\/)?dsh-plugin-[a-z0-9._-]+$/u.test(manifest.name)) {
    throw new Error(`Expected a dsh-plugin-* package in ${directory}`)
  }
  // Resolve the package's declared host entry, rather than assuming every plugin uses lib/index.js.
  const require = createRequire(path.join(directory, "package.json"))
  let host: string
  try { host = require.resolve(manifest.name) } catch { host = require.resolve(directory) }
  await access(host)
  return { directory, name: manifest.name, manifest }
}

/** A disposable native DSH profile. Never change the installed profile or runtime. */
export async function createDevelopmentProfile(base: ManagedDshPaths, directories: string[], passiveDirectories: string[] = []) {
  const projects = await Promise.all(directories.map(readDevelopmentProject))
  if (new Set(projects.map(p => p.name)).size !== projects.length) throw new Error("Two development projects declare the same package name")
  const passive = new Set(await Promise.all(passiveDirectories.map(p => realpath(p))))
  const profileName = `${base.profileName}-dev-${randomUUID()}`
  const profileDir = path.join(base.home, "profiles", profileName)
  const paths = { ...base, profileName, profileDir,
    profileManifest: path.join(profileDir, "package.json"),
    profilePatch: path.join(profileDir, "cordis.patch.yml"),
    profileManagedPatch: path.join(profileDir, "amiba.managed.patch.yml"),
    profileWorkspace: path.join(profileDir, "pnpm-workspace.yaml"),
    profileLock: path.join(profileDir, "pnpm-lock.yaml"),
  }
  const dispose = () => rm(profileDir, { recursive: true, force: true })
  try {
    await mkdir(profileDir, { recursive: true, mode: 0o700 })
    const manifest = JSON.parse(await readFile(base.profileManifest, "utf8"))
    const links = new Map<string, string>()
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      try { links.set(name, resolveInstalledPackageDirectory(base.profileManifest, name)) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "MODULE_NOT_FOUND") throw error
        links.set(name, resolveInstalledPackageDirectory(base.entrypoint, name))
      }
    }
    manifest.amibaDevelopmentPackages = projects.filter(project => !passive.has(project.directory)).map(project => project.name)
    manifest.dependencies ??= {}
    for (const project of projects) {
      links.set(project.name, project.directory)
      manifest.dependencies[project.name] = `link:${project.directory}`
      if (!passive.has(project.directory) && project.manifest.dsh?.bundle && !manifest.dsh.profile.bundles.includes(project.name)) {
        manifest.dsh.profile.bundles.push(project.name)
      }
    }
    for (const [name, target] of links) {
      const link = path.join(profileDir, "node_modules", name)
      await mkdir(path.dirname(link), { recursive: true })
      await symlink(await realpath(target), link, process.platform === "win32" ? "junction" : "dir")
    }
    await writeFile(paths.profileManifest, JSON.stringify(manifest, null, 2) + "\n")
    for (const [source, target] of [[base.profilePatch, paths.profilePatch], [base.profileManagedPatch, paths.profileManagedPatch]]) {
      try { await copyFile(source, target) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
    // Ask the installed DSH composer which entries exist. This preserves bundle
    // config, disabled entries, and !!js expressions without maintaining our own YAML parser.
    // Electron embeds an older Node than DSH. Compose using DSH's own managed
    // Node, so importing the Loader can never depend on Electron's Node APIs.
    const { stdout } = await promisify(execFile)(base.node, ["--input-type=module", "--eval", `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      import path from 'node:path';
      const [entrypoint, name, home] = process.argv.slice(1);
      const require = createRequire(entrypoint);
      const boot = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
      const profile = boot.loadProfile('amiba', name, entrypoint, home);
      const patches = boot.loadOptionalPatches('amiba', path.join(home, 'cordis.patch.yml')) ?? [];
      const rows = boot.composeEntries([profile.layers.flatMap(layer => layer.patches), profile.patches, patches]);
      const names = new Set();
      function visit(entries) { for (const row of entries) { if (row.name) names.add(row.name); if (Array.isArray(row.config)) visit(row.config); } }
      visit(rows);
      process.stdout.write(JSON.stringify([...names]));
    `, base.entrypoint, profileName, base.home], { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const names = new Set<string>(JSON.parse(stdout));
    const inserted = projects.filter(p => !passive.has(p.directory) && !p.manifest.dsh?.bundle && !names.has(p.name)).map(p => ({
      id: `amiba-dev-${createHash("sha256").update(p.name).digest("hex").slice(0, 16)}`, name: p.name,
    }))
    const overlay = path.join(profileDir, "development.patch.json")
    const roots = await Promise.all(projects.map(async p => realpath(path.join(p.directory, "lib"))))
    await writeFile(overlay, JSON.stringify([
      ...(inserted.length ? [{ insert: inserted }] : []),
      { id: "hmr", disabled: false, config: { root: roots, debounce: 300 } },
    ], null, 2))
    // Linked plugins otherwise resolve a second copy of the host protocol from
    // their own node_modules. Its private Remote registry is invisible to the
    // managed gateway, which then returns 404 for every plugin method.
    const preload = path.join(profileDir, "development-host-modules.mjs")
    await writeFile(preload, `
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const parentURL = pathToFileURL(${JSON.stringify(base.entrypoint)}).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  // Node's nextResolve mutates the shared context, even when it throws.
  // Capture the caller before trying the host's singleton dependency tree.
  const originalContext = { ...context };
  if (specifier.startsWith('@deepseek-ai/')) {
    try { return nextResolve(specifier, { ...context, parentURL }); }
    catch (error) { if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error; }
  }
  return nextResolve(specifier, originalContext);
} });
`)
    return { paths, overlay, preload, projects, dispose }
  } catch (error) { await dispose(); throw error }
}

/** Build to a sibling staging directory; only publish a complete successful build. */
export async function buildDevelopmentProject(directory: string, options: { signal?: AbortSignal } = {}): Promise<void> {
  const { spawn } = await import("node:child_process")
  const fs = await import("node:fs/promises")
  directory = await realpath(directory)
  const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"))
  const stage = await fs.mkdtemp(path.join(directory, ".amiba-build-"))
  const quote = (value: string) => process.platform === "win32" ? `"${value.replaceAll('"', '""')}"` : `'${value.replaceAll("'", "'\\''")}'`
  try {
    let command: string = manifest.scripts?.build ?? "amiba plugin build"
    if (/^amiba plugin build\s*$/u.test(command)) {
      command = "tsc -p tsconfig.build.json" + (manifest.dsh?.client ? " && vite build" : "") + (manifest.dsh?.native ? " && vite build --config vite.native.config.ts" : "")
    }
    if (!/\btsc\b/u.test(command)) throw new Error("Development builds currently require a tsc-based build script")
    command = command.replace(/\btsc\b/gu, `tsc --noEmitOnError --outDir ${quote(stage)}`)
      .replace(/\bvite build\b/gu, `vite build --outDir ${quote(stage)} --emptyOutDir false`)
    const bin = await realpath(path.join(directory, "node_modules/.bin")).catch(() => path.join(directory, "node_modules/.bin"))
    options.signal?.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, {
        shell: true, cwd: directory, stdio: "inherit", detached: process.platform !== "win32",
        env: { ...process.env, PATH: [bin, process.env.PATH].join(path.delimiter) },
      })
      const abort = () => {
        if (!child.pid) return
        try {
          if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" })
          else process.kill(-child.pid, "SIGTERM")
        } catch { /* Child already exited. */ }
      }
      options.signal?.addEventListener("abort", abort, { once: true })
      child.once("error", error => { options.signal?.removeEventListener("abort", abort); reject(error) })
      child.once("exit", code => {
        options.signal?.removeEventListener("abort", abort)
        code === 0 ? resolve() : reject(new Error(`Plugin build failed (${code})`))
      })
    })
    options.signal?.throwIfAborted()
    const output = path.join(directory, "lib")
    const files = (await fs.readdir(stage, { recursive: true })).sort((a, b) =>
      Number(a === "client.js") - Number(b === "client.js") || Number(a === "index.js") - Number(b === "index.js"))
    let nativeChanged = false
    for (const relative of files) {
      const source = path.join(stage, relative)
      if (!(await fs.stat(source)).isFile()) continue
      const target = path.join(output, relative)
      const bytes = await fs.readFile(source)
      try { if (bytes.equals(await fs.readFile(target))) continue } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
      await mkdir(path.dirname(target), { recursive: true })
      const pending = `${target}.pending`
      await fs.writeFile(pending, bytes)
      await fs.rename(pending, target)
      if (manifest.dsh?.native === `./lib/${relative}`) nativeChanged = true
    }
    // Native providers release their Electron lease from their host dispose hook.
    // Reload the host after a native-only edit so that lifecycle runs as well.
    if (nativeChanged) {
      const entry = createRequire(path.join(directory, "package.json")).resolve(directory)
      await fs.appendFile(entry, `\n// native build ${randomUUID()}\n`)
    }
  } finally { await fs.rm(stage, { recursive: true, force: true }) }
}
