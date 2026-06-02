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
  token: string
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

/** Health check response from GET /health. */
export interface GBrainHealthResult {
  status: string
  version?: string
  db?: string
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
    this.token = opts.token
  }

  /**
   * Update connection config (e.g. user changed URL/token in settings).
   * Resets the handshake so the next call re-initializes.
   * No-op if config hasn't changed (avoids unnecessary re-handshake).
   */
  configure(opts: GBrainClientOptions): void {
    const newBase = opts.baseUrl.replace(/\/+$/, "")
    if (newBase === this.baseUrl && opts.token === this.token) return
    this.baseUrl = newBase
    this.token = opts.token
    this.initialized = false
  }

  // -------------------------------------------------------------------------
  // Health (unauthenticated, no MCP handshake needed)
  // -------------------------------------------------------------------------

  /**
   * Ping gbrain's `GET /health` endpoint. No auth required.
   * Returns null if gbrain is unreachable.
   */
  async health(): Promise<GBrainHealthResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) return null
      return (await res.json()) as GBrainHealthResult
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

    const res = await fetch(`${this.baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `gbrain HTTP ${res.status}: ${text || res.statusText}`,
      )
    }

    const json = (await res.json()) as JsonRpcResponse

    if (json.error) {
      throw new Error(
        `gbrain RPC error ${json.error.code}: ${json.error.message}`,
      )
    }

    return json.result
  }

  // -------------------------------------------------------------------------
  // MCP initialize handshake
  // -------------------------------------------------------------------------

  private async initialize(): Promise<void> {
    try {
      // Step 1: initialize
      const initResult = (await this.rpc(
        "initialize",
        {},
      )) as InitializeResult
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
