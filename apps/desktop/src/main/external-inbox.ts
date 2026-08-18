/**
 * External entry points that let other programs hand Amiba a prompt:
 *
 *   1. Custom URL protocol — `amiba://prompt?text=...` (or
 *      `amiba://?text=...`, or anything with a `text` query param).
 *      The OS hands the URL back via `open-url` (mac) or as an argv tail
 *      on the second-instance launch (win/linux).
 *
 *   2. Local IPC — `<userData>/inbox.sock` on macOS/Linux or a stable named
 *      pipe on Windows, with line-delimited JSON
 *      `{ "text": "...", "attachments": [...], "sourceApp": "..." }\n`.
 *
 * Both funnel into `deliverPrompt`, which writes the hand-off into
 * `home.pendingPrompt` (the same key HomeView uses) and summons the
 * window. The renderer's existing watcher flips to the chat view, and
 * ChatSurface's mount drain picks the payload up — text into the
 * composer, attachments into the live attachment list, sourceApp shown
 * as a small chip.
 *
 * Size limits: a 64KB cap is enforced on per-line socket payloads and
 * on URL `?text=` values so a misbehaving caller can't flood storage.
 */
import fs from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { app } from "electron"

import { dshAttachments } from "./dsh-attachments"
import { inboxSocketPathFor } from "./external-inbox-path"
import { mainStore } from "./storage"

export { inboxSocketPathFor } from "./external-inbox-path"

const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt"
export const PROTOCOL_SCHEME = "amiba"

/** Max bytes for a single URL `?text=` value or one socket line. */
const MAX_PAYLOAD_BYTES = 64 * 1024
/** Max attachments per delivered prompt. */
const MAX_ATTACHMENTS = 16

type Summon = () => void

/**
 * Mirrors the wire shape stored under `home.pendingPrompt` so every
 * surface (Spotlight, Snip, URL, socket, HomeView) speaks the same
 * dialect. All fields are optional but at least one of `text` or
 * `attachments` must be set for the renderer to do anything useful.
 */
export interface DeliverPromptPayload {
  text?: string
  attachments?: DeliverPromptAttachment[]
  sourceApp?: string
}

export interface DeliverPromptAttachment {
  uiId?: string
  name?: string
  mime?: string
  size?: number
  kind?: "image" | "text" | "pdf" | "binary"
  path: string
  thumbDataUrl?: string
  textPreview?: string
}

export interface StagedPromptAttachment
  extends Omit<DeliverPromptAttachment, "path" | "uiId" | "name" | "mime" | "size" | "kind"> {
  uiId?: string
  name: string
  mime: string
  size: number
  kind: "image" | "text" | "pdf"
  attachmentId: string
}

function attachmentKind(
  attachment: DeliverPromptAttachment,
): "image" | "text" | "pdf" | null {
  if (
    attachment.kind === "image" ||
    attachment.kind === "text" ||
    attachment.kind === "pdf"
  ) {
    return attachment.kind
  }
  const mime = (attachment.mime ?? "").toLowerCase()
  if (mime === "application/pdf") return "pdf"
  if (mime.startsWith("text/") || /(?:json|xml|javascript|typescript|yaml)/u.test(mime)) {
    return "text"
  }
  const extension = path.extname(attachment.name || attachment.path).toLowerCase()
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(extension)) return "image"
  if (extension === ".pdf") return "pdf"
  if ([
    ".txt", ".md", ".csv", ".tsv", ".json", ".jsonc", ".yml", ".yaml",
    ".toml", ".ini", ".xml", ".html", ".css", ".js", ".jsx", ".ts",
    ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".h", ".cpp",
    ".sh", ".zsh", ".sql", ".graphql", ".vue", ".svelte", ".log",
  ].includes(extension)) return "text"
  return null
}

function nativeImage(
  attachment: DeliverPromptAttachment,
): boolean {
  const mime = (attachment.mime ?? "").toLowerCase()
  if (["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mime)) {
    return true
  }
  if (mime && mime !== "application/octet-stream") return false
  return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(
    path.extname(attachment.name || attachment.path).toLowerCase(),
  )
}

/**
 * Write to the same key HomeView writes, then raise the window. Returns
 * `false` when the payload had nothing to deliver, so callers can skip
 * the (now-pointless) summon.
 */
export async function deliverPrompt(
  payload: DeliverPromptPayload,
  summon: Summon,
): Promise<boolean> {
  const text = payload.text?.trim() ?? ""
  const attachments: StagedPromptAttachment[] = []
  for (const [index, attachment] of (payload.attachments ?? [])
    .slice(0, MAX_ATTACHMENTS)
    .entries()) {
    const kind = attachmentKind(attachment)
    if (!kind || (kind === "image" && !nativeImage(attachment))) {
      console.warn(
        "[external-inbox] dropping unsupported attachment:",
        attachment.name ?? attachment.path,
      )
      continue
    }
    const name = attachment.name?.trim() || path.basename(attachment.path) || "file"
    const mime = attachment.mime?.trim() || "application/octet-stream"
    try {
      const staged = await dshAttachments.importFile({
        sessionId: `inbox-${Date.now()}-${index}`,
        name,
        mime,
        path: attachment.path,
      })
      attachments.push({
        ...attachment,
        name,
        mime,
        kind,
        attachmentId: staged.attachmentId,
        size: staged.size,
      })
    } catch (error) {
      console.warn(
        "[external-inbox] attachment import failed:",
        error instanceof Error ? error.message : error,
      )
    }
  }
  return deliverStagedPrompt(
    {
      text: text || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      sourceApp: payload.sourceApp,
    },
    summon,
  )
}

/** Internal hand-off for bytes already admitted by the DSH plugin. */
export async function deliverStagedPrompt(
  payload: {
    text?: string
    attachments?: StagedPromptAttachment[]
    sourceApp?: string
  },
  summon: Summon,
): Promise<boolean> {
  const text = payload.text?.trim() ?? ""
  const attachments = payload.attachments ?? []
  if (!text && attachments.length === 0) return false
  await mainStore.set({
    [HOME_PENDING_PROMPT_KEY]: {
      text: text || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      sourceApp: payload.sourceApp,
      ts: Date.now(),
    },
  })
  summon()
  return true
}

/**
 * Pull a prompt out of a `amiba://...` URL. Accepts `?text=...`
 * anywhere (`amiba://prompt?text=...`, `amiba://?text=...`, etc).
 * As a convenience, falls back to the URL path itself when no query is
 * present — `amiba://hello%20world` works.
 *
 * Returns `null` for invalid URLs, unrelated schemes, or when the
 * payload exceeds `MAX_PAYLOAD_BYTES` (so a 10MB prompt URL can't
 * deluge `mainStore`).
 */
export function extractPromptFromUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PROTOCOL_SCHEME}:`) return null
  const q = parsed.searchParams.get("text") ?? parsed.searchParams.get("prompt")
  let text: string | null = null
  if (q && q.trim()) {
    text = q
  } else {
    // host + pathname fallback: `amiba://hello%20world` → "hello world"
    const tail = decodeURIComponent(`${parsed.hostname}${parsed.pathname}`).trim()
    text = tail || null
  }
  if (!text) return null
  if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) {
    console.warn(
      "[external-inbox] dropping URL prompt: %d bytes exceeds %d-byte cap",
      Buffer.byteLength(text, "utf8"),
      MAX_PAYLOAD_BYTES,
    )
    return null
  }
  return text
}

/**
 * Scan a process argv list for the first `amiba://...` token. Used
 * for win/linux cold-start and second-instance launches, where the OS
 * appends the URL to argv rather than firing `open-url`.
 */
export function findProtocolUrlInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === "string" && arg.startsWith(`${PROTOCOL_SCHEME}://`)) {
      return arg
    }
  }
  return null
}

/**
 * Register `amiba://` as a protocol handler with the OS and start
 * listening for incoming URLs. Idempotent across calls.
 *
 * macOS routes URLs through `app.on("open-url")`. Windows + Linux push
 * the URL onto the launch argv of a second instance, which we surface
 * via `requestSingleInstanceLock` + the `"second-instance"` event.
 */
export function registerProtocolHandler(summon: Summon): void {
  // In dev (`electron .`), Electron is launched as a generic Electron
  // binary, so registering the scheme needs to include the script path
  // so the OS can re-launch us with the right argv. In a packaged build
  // the default form (no path/args) points at our app bundle directly.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
        path.resolve(process.argv[1]!),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME)
  }

  app.on("open-url", (event, url) => {
    event.preventDefault()
    const text = extractPromptFromUrl(url)
    if (text) void deliverPrompt({ text }, summon)
  })

  // Cold-start argv (win/linux): a URL that launched us before
  // `whenReady` fires shows up here.
  const cold = findProtocolUrlInArgv(process.argv)
  if (cold) {
    const text = extractPromptFromUrl(cold)
    if (text) void deliverPrompt({ text }, summon)
  }
}

/**
 * Hook into the single-instance lock so second-launch attempts (the
 * usual win/linux protocol path) re-deliver to the running process.
 * Must be called BEFORE `app.whenReady()` resolves — typically right
 * after `app.requestSingleInstanceLock()` returns true.
 */
export function attachSecondInstanceHandler(summon: Summon): void {
  app.on("second-instance", (_event, argv) => {
    summon()
    const url = findProtocolUrlInArgv(argv)
    if (!url) return
    const text = extractPromptFromUrl(url)
    if (text) void deliverPrompt({ text }, summon)
  })
}

// ---------------------------------------------------------------------------
// Unix socket inbox
// ---------------------------------------------------------------------------

/** Stable path other tools can connect to. */
export function inboxSocketPath(): string {
  return inboxSocketPathFor(process.platform, app.getPath("userData"))
}

interface InboxMessage {
  text?: unknown
  attachments?: unknown
  sourceApp?: unknown
}

function coerceAttachment(raw: unknown): DeliverPromptAttachment | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== "string" || !r.path) return null
  const kindStr = typeof r.kind === "string" ? r.kind : "binary"
  const kind: DeliverPromptAttachment["kind"] =
    kindStr === "image" || kindStr === "text" || kindStr === "pdf"
      ? kindStr
      : "binary"
  return {
    uiId: typeof r.uiId === "string" ? r.uiId : undefined,
    name: typeof r.name === "string" ? r.name : undefined,
    mime: typeof r.mime === "string" ? r.mime : undefined,
    size: typeof r.size === "number" ? r.size : undefined,
    kind,
    path: r.path,
    thumbDataUrl:
      typeof r.thumbDataUrl === "string" ? r.thumbDataUrl : undefined,
    textPreview:
      typeof r.textPreview === "string" ? r.textPreview : undefined,
  }
}

/**
 * Bind a Unix domain socket or Windows named pipe and parse line-delimited JSON. Each
 * connection may stream multiple `{ "text": "..." }` lines; we keep a
 * per-socket buffer so partial reads don't split a JSON object. The
 * per-line buffer is capped at `MAX_PAYLOAD_BYTES` — once exceeded the
 * connection is closed so a misbehaving client can't OOM us.
 */
export async function startUnixSocketInbox(
  summon: Summon,
): Promise<net.Server | null> {
  const socketPath = inboxSocketPath()
  // Stale sockets from a previous crashed run will make `listen()` fail
  // with EADDRINUSE. Probe by attempting to connect; if nothing answers
  // we can safely unlink. (Plain `unlink` would race against a healthy
  // sibling Amiba process, but we hold a single-instance lock above so
  // that can't actually happen — still, the connect probe keeps us
  // honest if someone disables the lock later.)
  if (process.platform !== "win32") {
    await fs.mkdir(path.dirname(socketPath), { recursive: true })
    await removeStaleSocket(socketPath)
  }

  const server = net.createServer((conn) => {
    let buf = ""
    conn.setEncoding("utf8")
    conn.on("data", (chunk: string) => {
      buf += chunk
      // If a single line grows past the cap before we hit a newline, the
      // client is misbehaving — drop it.
      if (buf.length > MAX_PAYLOAD_BYTES) {
        console.warn(
          "[external-inbox] dropping connection: line exceeds %d-byte cap",
          MAX_PAYLOAD_BYTES,
        )
        conn.destroy()
        return
      }
      let nl = buf.indexOf("\n")
      while (nl >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) handleInboxLine(line, summon)
        nl = buf.indexOf("\n")
      }
    })
    conn.on("error", () => {
      // best-effort: a flaky client shouldn't take the server down
    })
  })

  server.on("error", (err) => {
    console.error("[external-inbox] socket server error:", err)
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => {
      server.off("error", reject)
      resolve()
    })
  })

  // Lock down to the current user — the socket lives in userData
  // (already user-private) but the file's default mode follows umask,
  // which can be 0666. Explicitly chmod to 0600 so other local users
  // can't drop prompts into our window.
  if (process.platform !== "win32") {
    try {
      await fs.chmod(socketPath, 0o600)
    } catch {
      // best-effort
    }
  }

  return server
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  try {
    await fs.access(socketPath)
  } catch {
    return // doesn't exist, nothing to clean
  }
  // Try connecting; if it works, something is already listening and we
  // should bail rather than nuke a sibling's socket. With the
  // single-instance lock in place this branch is effectively dead.
  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath)
    const done = (v: boolean) => {
      probe.destroy()
      resolve(v)
    }
    probe.once("connect", () => done(true))
    probe.once("error", () => done(false))
  })
  if (alive) {
    throw new Error(
      `[external-inbox] socket already in use at ${socketPath}; refusing to unlink`,
    )
  }
  await fs.unlink(socketPath).catch(() => {})
}

function handleInboxLine(line: string, summon: Summon): void {
  let msg: InboxMessage
  try {
    msg = JSON.parse(line) as InboxMessage
  } catch {
    return
  }
  if (!msg || typeof msg !== "object") return
  const text =
    typeof msg.text === "string" && msg.text.trim() ? msg.text : undefined
  const sourceApp =
    typeof msg.sourceApp === "string" && msg.sourceApp.trim()
      ? msg.sourceApp
      : undefined
  let attachments: DeliverPromptAttachment[] | undefined
  if (Array.isArray(msg.attachments)) {
    const out: DeliverPromptAttachment[] = []
    for (const item of msg.attachments) {
      const norm = coerceAttachment(item)
      if (norm) out.push(norm)
    }
    if (out.length > 0) attachments = out
  }
  if (!text && !attachments) return
  void deliverPrompt({ text, attachments, sourceApp }, summon)
}

export async function stopUnixSocketInbox(
  server: net.Server | null,
): Promise<void> {
  if (!server) return
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (process.platform !== "win32") {
    await fs.unlink(inboxSocketPath()).catch(() => {})
  }
}
