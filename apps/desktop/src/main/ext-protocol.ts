/**
 * `hermes-ext://<extensionId>/<path-inside-extension>` — custom protocol that
 * lets the renderer dynamically import extension bundles without tripping
 * Chromium's "Not allowed to load local resource" wall on `file://`.
 *
 * The renderer can't load file:// URLs directly (XSS / local-file disclosure
 * protection). So instead of `import("file:///.../dist/renderer.js")` we use
 * `import("hermes-ext://<id>/dist/renderer.js")` — the protocol handler runs
 * in main, looks the extension up in the registry, and serves the file's
 * bytes back with CORS headers permissive enough for ESM cross-origin module
 * loading.
 */
import { readFile } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"
import { protocol } from "electron"
import { findEntry } from "@hermes-x/extension-host/main"

const SCHEME = "hermes-ext"

const MIME_BY_EXT: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".cjs": "application/javascript",
  ".map": "application/json",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
}

/**
 * Call BEFORE `app.whenReady()`. Marks the scheme as standard (URL parsing
 * with host + path) + secure (treated as HTTPS-like, so importing modules
 * from this scheme works without "blocked because not secure" warnings).
 * `supportFetchAPI` lets `fetch()` and dynamic `import()` accept it;
 * `corsEnabled: true` so the renderer's same-origin policy lets cross-origin
 * ESM imports through (combined with the ACA-Origin headers below).
 */
export function registerExtProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/**
 * Call AFTER `app.whenReady()` once the registryPath is known. Resolves URLs
 * of the form `hermes-ext://<extensionId>/<relative-path>` by reading
 * `<entry.path>/<relative-path>` from disk. Refuses anything that escapes
 * the extension root via `..`.
 */
export function registerExtProtocolHandler(registryPath: string): void {
  protocol.handle(SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response("invalid URL", { status: 400 })
    }
    const extensionId = url.hostname
    if (!extensionId) return new Response("missing extension id", { status: 400 })

    const entry = findEntry(registryPath, extensionId)
    if (!entry) return new Response(`unknown extension: ${extensionId}`, { status: 404 })

    // url.pathname is something like "/dist/renderer.js"; strip the leading
    // slash and resolve against the extension root. Then guard against
    // path traversal — the final resolved path MUST live inside entry.path.
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    const root = resolve(entry.path)
    const abs = resolve(join(root, rel))
    if (!abs.startsWith(root + sep) && abs !== root) {
      return new Response("path traversal blocked", { status: 403 })
    }
    if (normalize(rel).startsWith("..")) {
      return new Response("path traversal blocked", { status: 403 })
    }

    try {
      const bytes = await readFile(abs)
      const mime = MIME_BY_EXT[extname(abs).toLowerCase()] ?? "application/octet-stream"
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          // ESM cross-origin import + dev-tool source-map fetch need CORS.
          "Access-Control-Allow-Origin": "*",
          // Stop any HTTP layer from caching — the renderer cache-busts via
          // a `?t=…` query string already, but belt-and-braces.
          "Cache-Control": "no-store",
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return new Response(`failed to read ${rel}: ${message}`, { status: 404 })
    }
  })
}
