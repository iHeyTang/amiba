/**
 * GBrain HTTP client — MCP JSON-RPC 2.0 transport.
 *
 * Talks to a running `gbrain serve --http` instance. All operations go
 * through `POST /mcp` using the MCP protocol (initialize → tools/call).
 * A single `GBrainClient` instance holds connection config and handles
 * the handshake lifecycle.
 *
 * This module lives in the Electron main process. The renderer accesses
 * it through the `gbrain:call` IPC channel (see ./ipc.ts) because the
 * renderer's fetch is subject to CORS, while the main process is not.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GBrainClientOptions {
  baseUrl: string
  /**
   * Bearer token for gbrain servers running with `--auth-token`.
   * Empty / undefined = no Authorization header (the default for our
   * one-click-installed local serve, which runs unauthenticated).
   */
  token?: string
}

/** Shape of a JSON-RPC 2.0 response from gbrain's /mcp endpoint. */
interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

/** Shape of the MCP initialize result. */
interface InitializeResult {
  protocolVersion: string
  serverInfo: { name: string; version: string }
  capabilities: Record<string, unknown>
}

/**
 * Health check response from gbrain's GET /health.
 *
 * Field shape varies across versions:
 *   - Released 0.42.x: { status: 'ok', version, engine }
 *   - Master / unreleased: + transport: 'http', db
 *
 * We treat both as valid. Identity check (see `health()`) accepts any
 * response where `status === 'ok'` literally AND `version` is a
 * non-empty string — that combination filters out generic /health
 * endpoints on other services (`{"status": true}`, plain `{"ok": true}`,
 * FastAPI errors with `{"detail":...}`) without locking us to a
 * specific gbrain release's optional fields.
 */
export interface GBrainHealthResult {
  status: string
  version?: string
  db?: string
  transport?: string
  engine?: string
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GBrainClient {
  private baseUrl: string
  private token: string
  private initialized = false
  private requestId = 0

  constructor(opts: GBrainClientOptions) {
    // Strip trailing slash
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "")
    this.token = opts.token ?? ""
  }

  /**
   * Update connection config (URL and/or token changed). Resets the
   * handshake so the next call re-initializes. No-op if nothing changed.
   */
  configure(opts: GBrainClientOptions): void {
    const newBase = opts.baseUrl.replace(/\/+$/, "")
    const newToken = opts.token ?? ""
    if (newBase === this.baseUrl && newToken === this.token) return
    this.baseUrl = newBase
    this.token = newToken
    this.initialized = false
  }

  // -------------------------------------------------------------------------
  // Health (unauthenticated, no MCP handshake needed)
  // -------------------------------------------------------------------------

  /**
   * Ping gbrain's `GET /health` endpoint. No auth required.
   * Returns null if gbrain is unreachable OR if the responder isn't
   * actually gbrain (some other service on the same port may answer
   * with an OK-shaped JSON — we want to refuse those rather than
   * stream MCP calls into a stranger and fail later with a confusing
   * 405/422/etc).
   *
   * Identity check: accept any response with `status === "ok"`
   * (literal string — `{"status": true}` and other generic shapes
   * fail this) AND a non-empty `version` string. Both released gbrain
   * (`{status, version, engine}`) and master (`{status, version,
   * transport, db}`) satisfy these; common false-positives
   * (`{"status": true}`, `{"ok": true}`, FastAPI's `{"detail":...}`)
   * do not.
   */
  async health(): Promise<GBrainHealthResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return null
      const body = (await res.json()) as Partial<GBrainHealthResult>
      if (body?.status !== "ok") return null
      if (typeof body.version !== "string" || !body.version) return null
      return body as GBrainHealthResult
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // MCP tool calls
  // -------------------------------------------------------------------------

  /**
   * Call any gbrain MCP tool. Handles the initialize handshake
   * automatically on the first call (or after a configure() reset).
   *
   * @param tool  Tool name, e.g. "search", "put_page", "list_pages"
   * @param args  Tool arguments (tool-specific)
   */
  async call<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.initialized) await this.initialize()
    const result = await this.rpc("tools/call", {
      name: tool,
      arguments: args ?? {},
    })
    // MCP tools/call wraps the response in result.content[0].text
    // which is a JSON string. Parse it.
    return this.extractContent<T>(result)
  }

  /**
   * Force a fresh MCP `initialize` handshake. Used to verify the server
   * actually speaks MCP (and not just /health), e.g. catching the case
   * where gbrain came up but the MCP transport failed to mount.
   */
  async verifyHandshake(): Promise<void> {
    this.initialized = false
    await this.initialize()
  }

  // -------------------------------------------------------------------------
  // JSON-RPC transport
  // -------------------------------------------------------------------------

  private async rpc(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method,
      params: params ?? {},
      id,
    })

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `gbrain HTTP ${res.status}: ${text || res.statusText}`,
      )
    }

    // The MCP Streamable HTTP transport lets the server respond with
    // either application/json OR text/event-stream — we advertised
    // both in Accept, so we have to handle both here. Servers that
    // wrap responses in SSE send `event: message\ndata: <json>\n\n`.
    const contentType = res.headers.get("content-type") ?? ""
    const json = contentType.includes("text/event-stream")
      ? await this.readSseResponse(res, id)
      : ((await res.json()) as JsonRpcResponse)

    if (json.error) {
      throw new Error(
        `gbrain RPC error ${json.error.code}: ${json.error.message}`,
      )
    }

    return json.result
  }

  /**
   * Parse a one-shot SSE response from /mcp and return the JSON-RPC
   * payload matching `expectedId`. Each SSE event looks like:
   *
   *   event: message
   *   data: {"jsonrpc":"2.0","id":1,"result":{...}}
   *
   * A single response may contain progress notifications before the
   * final result, so we walk every `data:` line and return the first
   * one that is a JSON-RPC response with the matching id.
   */
  private async readSseResponse(
    res: Response,
    expectedId: number,
  ): Promise<JsonRpcResponse> {
    const raw = await res.text()
    // SSE events are separated by blank lines; data fields may span
    // multiple `data:` lines within one event (joined by '\n').
    const events = raw.split(/\r?\n\r?\n/)
    for (const evt of events) {
      const dataLines: string[] = []
      for (const line of evt.split(/\r?\n/)) {
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""))
        }
      }
      if (dataLines.length === 0) continue
      const payload = dataLines.join("\n")
      try {
        const parsed = JSON.parse(payload) as Partial<JsonRpcResponse>
        if (parsed.jsonrpc === "2.0" && parsed.id === expectedId) {
          return parsed as JsonRpcResponse
        }
      } catch {
        // Not JSON (e.g. a ping/comment) — skip.
      }
    }
    throw new Error(
      `gbrain: no matching JSON-RPC response in SSE stream (id=${expectedId})`,
    )
  }

  // -------------------------------------------------------------------------
  // MCP initialize handshake
  // -------------------------------------------------------------------------

  private async initialize(): Promise<void> {
    try {
      // Step 1: initialize. The MCP spec requires protocolVersion,
      // capabilities, and clientInfo — sending {} makes strict servers
      // (newer gbrain validates with zod) reject with -32603.
      const initResult = (await this.rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "hermes-x-desktop", version: "0.1.0" },
      })) as InitializeResult
      console.log(
        "[gbrain] connected to %s v%s (protocol %s)",
        initResult.serverInfo?.name,
        initResult.serverInfo?.version,
        initResult.protocolVersion,
      )

      // Step 2: notify initialized
      // notifications/ don't expect a result; gbrain returns 204.
      // The rpc() method will try to parse JSON, so we handle this
      // as a best-effort — if it fails, the server still accepted
      // the notification.
      try {
        await this.rpc("notifications/initialized", {})
      } catch {
        // 204 No Content isn't valid JSON — this is expected.
      }

      this.initialized = true
    } catch (err) {
      this.initialized = false
      throw new Error(
        `gbrain initialize failed: ${(err as Error).message}`,
      )
    }
  }

  // -------------------------------------------------------------------------
  // Response parsing
  // -------------------------------------------------------------------------

  /**
   * MCP tools/call returns:
   *   { content: [{ type: "text", text: "<JSON string>" }], isError?: boolean }
   *
   * Extract and parse the JSON from content[0].text.
   */
  private extractContent<T>(result: unknown): T {
    if (!result || typeof result !== "object") {
      throw new Error("gbrain: empty response")
    }

    const r = result as {
      content?: Array<{ type: string; text: string }>
      isError?: boolean
    }

    if (r.isError) {
      const errText = r.content?.[0]?.text ?? "unknown error"
      // Try to parse structured error
      try {
        const parsed = JSON.parse(errText) as {
          error?: string
          message?: string
        }
        throw new Error(
          `gbrain tool error: ${parsed.message ?? parsed.error ?? errText}`,
        )
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("gbrain tool error:"))
          throw e
        throw new Error(`gbrain tool error: ${errText}`)
      }
    }

    const text = r.content?.[0]?.text
    if (!text) {
      // Some tools return empty content on success (e.g. delete_page)
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      // If it's not JSON, return the raw text
      return text as unknown as T
    }
  }
}
