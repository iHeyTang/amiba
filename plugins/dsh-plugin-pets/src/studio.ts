import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep, extname } from "node:path";
/** Serve the npm package's built application, with its own bundled React. */
export class StudioHost {
  private server: Server | undefined;
  private pending: Promise<string> | undefined;
  private disposed = false;
  open() {
    if (this.disposed)
      return Promise.reject(new Error("Pet plugin is unloaded"));
    return (this.pending ??= this.start().catch((e) => {
      this.pending = undefined;
      throw e;
    }));
  }
  private async start() {
    const root = join(
      dirname(createRequire(import.meta.url).resolve("@mofli/studio")),
      "dist",
    );
    await readFile(join(root, "index.html"));
    if (this.disposed) throw new Error("Pet plugin is unloaded");
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".json": "application/json",
      ".woff2": "font/woff2",
      ".png": "image/png",
    };
    const server = (this.server = createServer(async (req, res) => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.writeHead(405).end();
          return;
        }
        const pathname = decodeURIComponent(
          new URL(req.url ?? "/", "http://localhost").pathname,
        );
        const file = resolve(
          root,
          "." + (pathname === "/" ? "/index.html" : pathname),
        );
        if (!file.startsWith(root + sep)) {
          res.writeHead(403).end();
          return;
        }
        const target = extname(file) ? file : join(root, "index.html");
        const data = await readFile(target);
        res.setHeader(
          "Content-Type",
          mime[extname(target)] ?? "application/octet-stream",
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : data);
      } catch {
        res.writeHead(404).end("Not found");
      }
    }));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  }
  dispose() {
    this.disposed = true;
    this.server?.closeAllConnections();
    this.server?.close();
    this.server = undefined;
    this.pending = undefined;
  }
}
