// packages/extension-host/src/main/marketplace.ts
//
// Marketplace client for the main process.
// Unauthenticated GitHub API calls are subject to 60 req/h rate-limiting on
// the free tier. That is acceptable for v1; a future revision can thread in
// a PAT via settings if needed.

import { mkdirSync, rmSync, createWriteStream, existsSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { extract as tarExtract } from "tar"
import { validateManifest } from "./discover"
import { checkCompat } from "../compat"
import { HOST_API_VERSION } from "../version"
import { addEntry } from "./registry-store"
import type { ExtensionManifest } from "@amiba/extension-api"

export interface MarketplaceEntry {
  id: string
  name: string
  description?: string
  author?: string
  /** "owner/repo" — the plugin's own GitHub repository */
  repo: string
  /** Optional override: pin to a specific tag. Default = latest release. */
  version?: string
  /**
   * Optional SHA-256 of the `extension.tgz` asset (hex, case-insensitive).
   * When set, the install flow verifies the download against this digest and
   * refuses to install on mismatch. Marketplace maintainers should set this
   * for plugins that have shipped a release — it pins the binary against
   * tampering / release-asset replacement.
   */
  sha256?: string
}

export interface ResolvedRelease {
  entry: MarketplaceEntry
  version: string
  tarballUrl: string
  publishedAt: string
}

const DEFAULT_INDEX_URL =
  "https://raw.githubusercontent.com/amiba-desktop/amiba-marketplace/main/community-plugins.json"

export function getIndexUrl(): string {
  return process.env.AMIBA_MARKETPLACE_INDEX_URL || DEFAULT_INDEX_URL
}

export async function fetchIndex(): Promise<MarketplaceEntry[]> {
  const url = getIndexUrl()
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) {
    throw new Error(`fetchIndex: HTTP ${res.status} from ${url}`)
  }
  const data = (await res.json()) as MarketplaceEntry[]
  if (!Array.isArray(data)) {
    throw new Error(`fetchIndex: expected an array, got ${typeof data}`)
  }
  return data
}

/**
 * Look up the latest GitHub Release for a marketplace entry. Returns
 * the tarball URL of the `extension.tgz` asset attached to that release.
 *
 * If `entry.version` is set, fetch that tag instead of latest.
 */
export async function resolveRelease(
  entry: MarketplaceEntry,
): Promise<ResolvedRelease> {
  const base = `https://api.github.com/repos/${entry.repo}/releases`
  const url = entry.version
    ? `${base}/tags/${entry.version}`
    : `${base}/latest`
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
  })
  if (!res.ok) {
    throw new Error(`resolveRelease: HTTP ${res.status} from ${url}`)
  }
  const data = (await res.json()) as {
    tag_name: string
    published_at: string
    assets: Array<{ name: string; browser_download_url: string }>
  }
  const asset = data.assets.find((a) => a.name === "extension.tgz")
  if (!asset) {
    throw new Error(
      `resolveRelease: no extension.tgz asset in release ${data.tag_name} of ${entry.repo}`,
    )
  }
  return {
    entry,
    version: data.tag_name,
    tarballUrl: asset.browser_download_url,
    publishedAt: data.published_at,
  }
}

/**
 * Download a release tarball, extract into a temp dir, validate the manifest,
 * then move the staged dir into <extensionsDir>/<id>/. If the target already
 * exists, refuse (caller should uninstall first).
 *
 * Registers a marketplace entry in the registry after successful install.
 *
 * Returns the validated manifest on success.
 */
export async function installFromRelease(
  release: ResolvedRelease,
  extensionsDir: string,
  registryPath?: string,
): Promise<ExtensionManifest> {
  const stagingRoot = await mkdtemp(join(tmpdir(), "hermes-ext-install-"))
  try {
    // Download tarball
    const res = await fetch(release.tarballUrl)
    if (!res.ok || !res.body) {
      throw new Error(
        `download: HTTP ${res.status} from ${release.tarballUrl}`,
      )
    }
    const tarPath = join(stagingRoot, "extension.tgz")
    await pipeline(
      Readable.fromWeb(res.body as never),
      createWriteStream(tarPath),
    )

    // Verify SHA-256 if the marketplace entry provides one
    if (release.entry.sha256) {
      const { readFile } = await import("node:fs/promises")
      const buf = await readFile(tarPath)
      const actual = createHash("sha256").update(buf).digest("hex").toLowerCase()
      const expected = release.entry.sha256.toLowerCase()
      if (actual !== expected) {
        throw new Error(
          `install: sha256 mismatch — expected ${expected}, got ${actual}. Refusing to install.`,
        )
      }
    }

    // Extract
    const extractDir = join(stagingRoot, "extracted")
    mkdirSync(extractDir)
    await tarExtract({ file: tarPath, cwd: extractDir })

    // Validate manifest
    const manifestPath = join(extractDir, "manifest.json")
    if (!existsSync(manifestPath)) {
      throw new Error("install: tarball missing manifest.json at root")
    }
    const { readFile } = await import("node:fs/promises")
    const raw = JSON.parse(await readFile(manifestPath, "utf8"))
    const v = validateManifest(raw)
    if (!v.ok) {
      throw new Error(`install: invalid manifest — ${v.error}`)
    }
    if (v.manifest.id !== release.entry.id) {
      throw new Error(
        `install: manifest id "${v.manifest.id}" does not match marketplace entry id "${release.entry.id}"`,
      )
    }

    const compat = checkCompat(v.manifest.apiVersion, HOST_API_VERSION)
    if (!compat.ok) {
      throw new Error(`install: ${v.manifest.id} — ${compat.reason}`)
    }

    // Move into place
    const target = join(extensionsDir, v.manifest.id)
    if (existsSync(target)) {
      throw new Error(`install: ${target} already exists — uninstall first`)
    }
    mkdirSync(extensionsDir, { recursive: true })
    const { rename } = await import("node:fs/promises")
    await rename(extractDir, target)

    // Register the installed extension in the registry.
    if (registryPath) {
      addEntry(registryPath, {
        id: v.manifest.id,
        source: "marketplace",
        path: target,
        version: release.version,
        sha256: release.entry.sha256,
        installedAt: new Date().toISOString(),
      })
    }

    return v.manifest
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

