import kleur from "kleur"
import { resolveExtensionsDir } from "../lib/userdata.js"
import { addMarketplaceEntry, resolveRegistryPath } from "../lib/registry.js"
import { mkdirSync, existsSync, createWriteStream, rmSync } from "node:fs"
import { mkdtemp, readFile, rename } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { extract as tarExtract } from "tar"

interface InstallOptions {
  /** optional sha256 hex digest to verify against (case-insensitive) */
  sha256?: string
}

/**
 * `hermes-x install owner/repo[@tag]`
 *
 * Fetches the named (or latest) GitHub Release, finds the `extension.tgz`
 * asset, downloads, extracts, validates manifest, and installs into
 * `<userData>/extensions/<id>/`. This is the CLI sibling of the desktop
 * UI's "Install" button — both call into the same logical flow.
 *
 * We re-implement the install logic here rather than importing
 * extension-host/main, because the host package depends on Electron
 * (which isn't available in a plain Node CLI).
 */
export async function installCommand(repoArg: string, opts: InstallOptions) {
  // Parse owner/repo[@tag]
  let repo = repoArg
  let tag: string | undefined
  const at = repoArg.lastIndexOf("@")
  if (at > 0 && at > repoArg.indexOf("/")) {
    repo = repoArg.slice(0, at)
    tag = repoArg.slice(at + 1)
  }
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    throw new Error(`install: expected owner/repo (optionally @tag); got "${repoArg}"`)
  }

  const apiBase = `https://api.github.com/repos/${repo}/releases`
  const releaseUrl = tag ? `${apiBase}/tags/${tag}` : `${apiBase}/latest`
  console.log(kleur.dim(`→ ${releaseUrl}`))

  const res = await fetch(releaseUrl, { headers: { Accept: "application/vnd.github+json" } })
  if (!res.ok) {
    throw new Error(`install: HTTP ${res.status} from ${releaseUrl}`)
  }
  const release = await res.json() as {
    tag_name: string
    assets: Array<{ name: string; browser_download_url: string }>
  }
  const asset = release.assets.find((a) => a.name === "extension.tgz")
  if (!asset) {
    throw new Error(`install: release ${release.tag_name} has no extension.tgz asset`)
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), "hermes-ext-cli-install-"))
  try {
    const tarPath = join(stagingRoot, "extension.tgz")
    console.log(kleur.dim(`↓ ${asset.browser_download_url}`))
    const dl = await fetch(asset.browser_download_url)
    if (!dl.ok || !dl.body) {
      throw new Error(`install: download failed HTTP ${dl.status}`)
    }
    await pipeline(Readable.fromWeb(dl.body as never), createWriteStream(tarPath))

    // Always compute the actual sha256 — used for registry pinning even when
    // the caller didn't pass --sha256 (so later upgrades can compare).
    const buf = await readFile(tarPath)
    const actualSha = createHash("sha256").update(buf).digest("hex").toLowerCase()
    if (opts.sha256) {
      const expected = opts.sha256.toLowerCase()
      if (actualSha !== expected) {
        throw new Error(
          `install: sha256 mismatch\n  expected: ${expected}\n  actual:   ${actualSha}`,
        )
      }
      console.log(kleur.green("✓"), `sha256 verified (${actualSha.slice(0, 16)}…)`)
    }

    const extractDir = join(stagingRoot, "extracted")
    mkdirSync(extractDir)
    await tarExtract({ file: tarPath, cwd: extractDir })

    const manifestPath = join(extractDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      throw new Error("install: tarball missing manifest.json at root")
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { id?: string; name?: string; version?: string }
    if (!manifest.id) {
      throw new Error("install: manifest missing id")
    }

    const extDir = resolveExtensionsDir()
    mkdirSync(extDir, { recursive: true })
    const target = join(extDir, manifest.id)
    if (existsSync(target)) {
      throw new Error(
        `install: ${target} already exists. Uninstall first via the desktop UI or remove the directory manually.`,
      )
    }
    await rename(extractDir, target)

    // Register the install. The user invoked this command explicitly, so
    // they've consented to the install action — same trust contract as
    // clicking Install in the desktop UI's Browse tab. Without this step
    // the on-disk install would be invisible to the desktop's registry.
    const registryPath = resolveRegistryPath()
    addMarketplaceEntry(registryPath, {
      id: manifest.id,
      absolutePath: target,
      version: manifest.version ?? "0.0.0",
      sha256: actualSha,
    })

    console.log(
      kleur.green("✓"),
      `Installed ${kleur.cyan(`${manifest.name ?? manifest.id}@${manifest.version}`)}`,
    )
    console.log(kleur.dim(`  path:     ${target}`))
    console.log(kleur.dim(`  registry: ${registryPath}`))
    console.log(
      kleur.dim("  (Hermes Desktop will hot-reload this extension if it's running.)"),
    )
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}
