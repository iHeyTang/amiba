import { createServer, type Server } from "node:http"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { DESKTOP_DEVELOPMENT_FILE, readDevelopmentProject } from "@amiba/app-runtime/dsh-runtime"

type Lease = { directory: string; name: string; touched: number }

/** Authenticated local discovery/control only. DSH owns linking and hot reload. */
export async function servePluginDevelopment(options: {
  home: string
  change(directories: string[]): Promise<void>
}) {
  const token = randomBytes(32).toString("base64url")
  const leases = new Map<string, Lease>()
  let queue: Promise<unknown> = Promise.resolve()
  let closing = false
  const serialized = <T>(action: () => Promise<T>): Promise<T> => {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  async function remove(id: string) {
    const previous = leases.get(id)
    if (!previous) return
    leases.delete(id)
    try { await options.change([...leases.values()].map(l => l.directory)) }
    catch (error) { leases.set(id, previous); throw error }
  }
  const server: Server = createServer((request, response) => {
    void (async () => {
      // Browser pages cannot use this as a local installation API, even if a
      // discovery path is known. The owner-only token never enters a renderer.
      if (closing || request.headers.origin || request.headers.authorization !== `Bearer ${token}`) {
        response.writeHead(403).end(); return
      }
      if (request.method !== "POST") { response.writeHead(405).end(); return }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 16_384) throw new Error("Development request too large")
        chunks.push(chunk)
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      const result = request.url === "/ping" ? { pid: process.pid } : await serialized(async () => {
        if (request.url === "/connect") {
          if (typeof body.directory !== "string" || !path.isAbsolute(body.directory)) throw new Error("Expected an absolute plugin directory")
          const project = await readDevelopmentProject(body.directory)
          if ([...leases.values()].some(l => l.name === project.name)) throw new Error(`${project.name} already has a development session`)
          const id = randomUUID()
          leases.set(id, { directory: project.directory, name: project.name, touched: Date.now() })
          try { await options.change([...leases.values()].map(l => l.directory)) }
          catch (error) { leases.delete(id); throw error }
          leases.get(id)!.touched = Date.now()
          return { id, name: project.name }
        }
        if (typeof body.id !== "string" || !leases.has(body.id)) throw new Error("Development session expired; run amiba plugin dev again")
        if (request.url === "/heartbeat") { leases.get(body.id)!.touched = Date.now(); return {} }
        if (request.url === "/disconnect") { await remove(body.id); return {} }
        throw new Error("Unknown development operation")
      })
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result))
    })().catch(error => {
      if (!response.headersSent) response.writeHead(400, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    })
  })
  server.requestTimeout = 15_000
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No development listen address")
  const endpoint = { version: 1, url: `http://127.0.0.1:${address.port}`, token, pid: process.pid }
  await mkdir(options.home, { recursive: true, mode: 0o700 })
  const file = path.join(options.home, DESKTOP_DEVELOPMENT_FILE)
  const temporary = `${file}.${randomUUID()}`
  await writeFile(temporary, JSON.stringify(endpoint), { mode: 0o600 })
  await rename(temporary, file)
  const timer = setInterval(() => {
    void serialized(async () => {
      for (const [id, lease] of leases) if (Date.now() - lease.touched > 60_000) await remove(id)
    }).catch(error => console.error("Plugin development cleanup failed", error))
  }, 5_000)
  timer.unref()
  return {
    async close() {
      closing = true
      clearInterval(timer)
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
      await queue
      try {
        const current = JSON.parse(await readFile(file, "utf8"))
        if (current.token === token) await rm(file, { force: true })
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    },
  }
}
