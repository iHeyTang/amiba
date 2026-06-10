/**
 * Local HTTP server that serves extension WebView assets over
 * http://127.0.0.1:<port>/extensions/<extensionId>/<rest...>
 *
 * Binding to loopback only (never 0.0.0.0). Port is OS-assigned (port 0).
 */

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { findEntry } from "@amiba/extension-host/main"

// ---------------------------------------------------------------------------
// MIME map — intentionally minimal; default is application/octet-stream.
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
}

function mimeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME[ext] ?? "application/octet-stream"
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ExtHttpServer {
  /** http://127.0.0.1:<port> — available after start() resolves. */
  url(): string
  /** Idempotent shutdown. */
  stop(): Promise<void>
}

export interface StartOptions {
  /** Path to the registry JSON — used to look up <extensionId> → absolute path. */
  registryPath: string
}

export async function startExtHttpServer(opts: StartOptions): Promise<ExtHttpServer> {
  const { registryPath } = opts

  const server = http.createServer((req, res) => {
    // Only GET is needed; reject everything else.
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "text/plain" })
      res.end("Method Not Allowed")
      return
    }

    // Parse the URL. Expected shape: /extensions/<extensionId>/<rest...>
    let urlPath: string
    try {
      // Use a dummy base so URL can parse a path-only string.
      urlPath = new URL(req.url ?? "/", "http://localhost").pathname
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Bad Request")
      return
    }

    // Route: /extensions/<extensionId>/<rest...>
    const m = urlPath.match(/^\/extensions\/([^/]+)\/(.+)$/)
    if (!m) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not Found")
      return
    }

    const extensionId = decodeURIComponent(m[1]!)
    const relPath = m[2]! // e.g. "dist/ui/sidebar/index.html"

    // Look up extension root from registry.
    const entry = findEntry(registryPath, extensionId)
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Extension not found")
      return
    }

    const extensionRoot = path.resolve(entry.path)

    // Resolve the requested file path and guard against path traversal.
    // path.resolve with two absolute paths: second wins; with mixed, it
    // interprets rel against extensionRoot.
    const resolved = path.resolve(extensionRoot, relPath)

    // Security: the resolved path MUST stay within the extension root.
    // Add a trailing sep to avoid prefix collision (e.g. /foo/bar-evil vs /foo/bar).
    const safeRoot = extensionRoot.endsWith(path.sep)
      ? extensionRoot
      : extensionRoot + path.sep

    if (!resolved.startsWith(safeRoot) && resolved !== extensionRoot) {
      res.writeHead(403, { "Content-Type": "text/plain" })
      res.end("Forbidden")
      return
    }

    // Check file existence — stat before creating a read stream so we can
    // send a clean 404 instead of propagating an ENOENT stream error.
    fs.stat(resolved, (statErr, stat) => {
      if (statErr || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" })
        res.end("Not Found")
        return
      }

      res.writeHead(200, {
        "Content-Type": mimeFor(resolved),
        "Content-Length": stat.size,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      })

      const stream = fs.createReadStream(resolved)
      stream.on("error", () => {
        // Headers already sent; can only destroy.
        res.destroy()
      })
      stream.pipe(res)
    })
  })

  // Bind to loopback only, port 0 → OS assigns a free port.
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve())
    server.once("error", reject)
  })

  const addr = server.address()
  if (!addr || typeof addr === "string") {
    throw new Error("[ext-http-server] unexpected address after listen")
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`

  return {
    url(): string {
      return baseUrl
    },

    stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    },
  }
}
