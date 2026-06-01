/**
 * STT client — posts an audio blob to the backplane plugin's
 * ``/hermes/stt`` endpoint and returns the transcribed text.
 *
 * The HTTP backplane (``hermes-plugin-http-backplane``) hosts this
 * route and lazy-imports ``tools.transcription_tools.transcribe_audio``
 * from the upstream hermes-agent runtime in the same Python process.
 * That keeps the wire contract self-contained on the plugin side —
 * the renderer never reaches into hermes-agent directly, and we
 * don't need to modify upstream sources.
 *
 * Provider / model / API keys live in the user's existing
 * ``~/.hermes/config.yaml`` (``stt.*``) and ``~/.hermes/.env``. The
 * renderer does NOT select a provider per request; whatever the user
 * configured at the CLI level is what runs. The Voice settings page
 * reads ``GET /hermes/stt/status`` to surface that effective choice.
 */

import { backplaneFetch } from "./backplane-client"

export interface SttSuccess {
  ok: true
  text: string
  /** Which STT provider ran upstream (e.g. "local", "groq"). May be omitted. */
  provider?: string
  /** Round-trip time measured by the backplane side, in milliseconds. */
  durationMs?: number
}

export interface SttError {
  ok: false
  /** HTTP status; 0 means the backplane was unreachable. */
  status: number
  error: string
  /** Discriminator for client-side conditions so the UI can show a
   * translated message instead of an English fallback. */
  kind?: "timeout"
}

export type SttResult = SttSuccess | SttError

/**
 * Transcribe an audio blob.
 *
 * @param audio  The captured audio. The Blob's `type` (audio/webm,
 *               audio/wav, audio/ogg, …) is forwarded as Content-Type so
 *               the backplane picks the right demuxer.
 * @param opts.signal  AbortSignal to cancel mid-flight.
 * @param opts.timeoutMs  Reject after this many ms (default 60_000). Pass
 *                a longer value when the local model hasn't been cached
 *                yet, since the first call downloads ~150 MB.
 */
export async function transcribeAudio(
  audio: Blob,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SttResult> {
  const contentType = audio.type || "audio/webm"
  const timeoutMs = opts.timeoutMs ?? 60_000

  // Compose a single AbortSignal from the caller's signal + the timeout.
  // We can't use ``AbortSignal.timeout`` alone because we still need to
  // honour the caller's external cancellation, and ``any([])`` isn't on
  // Electron 33's bundled Chromium yet.
  const controller = new AbortController()
  const onExternalAbort = () =>
    controller.abort(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"))
  if (opts.signal) {
    if (opts.signal.aborted) onExternalAbort()
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true })
  }
  const timeoutId = setTimeout(
    () => controller.abort(new DOMException("Transcription timed out", "TimeoutError")),
    timeoutMs,
  )

  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: audio,
      signal: controller.signal,
    })
  } catch (e) {
    const err = e as DOMException | Error
    const isTimeout =
      (err as DOMException).name === "TimeoutError" ||
      /timed?\s*out/i.test(err?.message ?? "")
    return {
      ok: false,
      status: 0,
      error: isTimeout
        ? `Transcription timed out after ${Math.round(timeoutMs / 1000)}s`
        : String(err?.message || err),
      ...(isTimeout ? { kind: "timeout" as const } : {}),
    }
  } finally {
    clearTimeout(timeoutId)
    opts.signal?.removeEventListener("abort", onExternalAbort)
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Non-JSON body — fall through to the !res.ok branch below.
  }

  if (!res.ok) {
    // Backplane returns ``{"ok": false, "error": "..."}`` for failures.
    const errMsg =
      (body as { error?: string } | null)?.error ||
      `STT request failed (${res.status})`
    return { ok: false, status: res.status, error: errMsg }
  }

  const data = body as { text?: string; provider?: string; duration_ms?: number } | null
  return {
    ok: true,
    text: typeof data?.text === "string" ? data.text : "",
    provider: typeof data?.provider === "string" ? data.provider : undefined,
    durationMs:
      typeof data?.duration_ms === "number" ? data.duration_ms : undefined,
  }
}

export interface SttStatus {
  ok: true
  enabled: boolean
  /** Resolved provider after availability checks (e.g. "local", "none"). */
  provider: string
  /** Provider explicitly set in config.yaml, or null if auto-detected. */
  configured: string | null
  /** Providers detected as ready to run (deps installed + keys present). */
  available: string[]
  /** ``stt.local.model`` from config.yaml, or null. */
  localModel: string | null
  /** True iff ``localModel`` is already in the HF Hub cache. False both
   * when the model isn't downloaded yet and when the check can't run
   * (so the UI shows the download hint conservatively). */
  localModelCached: boolean
  /** Per-size cache state for the UI's known model list — lets the
   * settings page label every option without one round-trip per size. */
  localModelsCached: Record<string, boolean>
}

export type SttStatusResult = SttStatus | SttError

/**
 * Fetch the effective STT config. Used by the Voice settings page to
 * surface which provider will run, and to show which providers are
 * available based on what's installed and which keys are set.
 */
export async function getSttStatus(): Promise<SttStatusResult> {
  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt/status", { method: "GET" })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String((e as Error)?.message || e),
    }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* fall through */
  }

  if (!res.ok) {
    const errMsg =
      (body as { error?: string } | null)?.error ||
      `STT status request failed (${res.status})`
    return { ok: false, status: res.status, error: errMsg }
  }

  const data = body as
    | {
        enabled?: boolean
        provider?: string
        configured?: string | null
        available?: string[]
        local_model?: string | null
        local_model_cached?: boolean
        local_models_cached?: Record<string, unknown>
      }
    | null
  const rawMap = data?.local_models_cached
  const localModelsCached: Record<string, boolean> = {}
  if (rawMap && typeof rawMap === "object") {
    for (const [k, v] of Object.entries(rawMap)) {
      localModelsCached[k] = v === true
    }
  }
  return {
    ok: true,
    enabled: !!data?.enabled,
    provider: typeof data?.provider === "string" ? data.provider : "none",
    configured:
      typeof data?.configured === "string" ? data.configured : null,
    available: Array.isArray(data?.available) ? data.available : [],
    localModel:
      typeof data?.local_model === "string" ? data.local_model : null,
    localModelCached: data?.local_model_cached === true,
    localModelsCached,
  }
}

/* ---------- editable STT config (read/write) ----------------------------- */

export type SttProvider =
  | "local"
  | "groq"
  | "openai"
  | "mistral"
  | "elevenlabs"

/**
 * Wire model-field name per provider (must match what
 * ``transcription_tools`` reads from ``stt.<provider>``).
 * ``elevenlabs`` uses ``model_id``; everyone else uses ``model``.
 */
export type SttProviderModels = {
  local: { model: string | null }
  groq: { model: string | null }
  openai: { model: string | null }
  mistral: { model: string | null }
  elevenlabs: { model_id: string | null }
}

export interface SttCredentialState {
  /** True iff the env var (or any of its aliases) is non-empty on disk. */
  has_key: boolean
  /** Primary env var the renderer should write to. */
  env_var: string
}

export interface SttConfig {
  enabled: boolean
  /** Provider explicitly set in config.yaml, or null when unset. */
  provider: SttProvider | null
  providers: SttProviderModels
  /** Key-presence summary per provider (never returns the secret value). */
  credentials: Record<
    "groq" | "openai" | "mistral" | "elevenlabs",
    SttCredentialState
  >
}

export type SttConfigResult =
  | ({ ok: true } & SttConfig)
  | SttError

function parseSttConfig(data: unknown): SttConfig {
  const d = (data ?? {}) as Record<string, unknown>
  const providersRaw = (d.providers ?? {}) as Record<string, Record<string, unknown>>
  const credsRaw = (d.credentials ?? {}) as Record<string, Record<string, unknown>>
  const pickModel = (name: string, field: string): string | null => {
    const v = providersRaw[name]?.[field]
    return typeof v === "string" ? v : null
  }
  const pickCred = (name: string): SttCredentialState => {
    const raw = credsRaw[name] ?? {}
    return {
      has_key: !!raw.has_key,
      env_var: typeof raw.env_var === "string" ? raw.env_var : "",
    }
  }
  const provider = d.provider
  return {
    enabled: typeof d.enabled === "boolean" ? d.enabled : true,
    provider:
      provider === "local" ||
      provider === "groq" ||
      provider === "openai" ||
      provider === "mistral" ||
      provider === "elevenlabs"
        ? provider
        : null,
    providers: {
      local: { model: pickModel("local", "model") },
      groq: { model: pickModel("groq", "model") },
      openai: { model: pickModel("openai", "model") },
      mistral: { model: pickModel("mistral", "model") },
      elevenlabs: { model_id: pickModel("elevenlabs", "model_id") },
    },
    credentials: {
      groq: pickCred("groq"),
      openai: pickCred("openai"),
      mistral: pickCred("mistral"),
      elevenlabs: pickCred("elevenlabs"),
    },
  }
}

async function consumeConfigResponse(res: Response): Promise<SttConfigResult> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* fall through */
  }
  if (!res.ok) {
    const errMsg =
      (body as { error?: string } | null)?.error ||
      `STT config request failed (${res.status})`
    return { ok: false, status: res.status, error: errMsg }
  }
  return { ok: true, ...parseSttConfig(body) }
}

/**
 * Read the user's current STT config from ``~/.hermes/config.yaml`` +
 * ``~/.hermes/.env``. API key *values* are never returned — only
 * a boolean per provider via ``credentials.<provider>.has_key``.
 */
export async function getSttConfig(): Promise<SttConfigResult> {
  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt/config", { method: "GET" })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String((e as Error)?.message || e),
    }
  }
  return consumeConfigResponse(res)
}

/**
 * Patch the ``stt.*`` section. Send only the fields the user changed —
 * the backplane deep-merges into the existing config. Returns the
 * refreshed config on success so the UI doesn't need a second round-trip.
 */
export interface SttConfigPatch {
  enabled?: boolean
  provider?: SttProvider | null
  providers?: {
    local?: { model?: string | null }
    groq?: { model?: string | null }
    openai?: { model?: string | null }
    mistral?: { model?: string | null }
    elevenlabs?: { model_id?: string | null }
  }
}

export async function setSttConfig(
  patch: SttConfigPatch,
): Promise<SttConfigResult> {
  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String((e as Error)?.message || e),
    }
  }
  return consumeConfigResponse(res)
}

/**
 * Write provider API keys to ``~/.hermes/.env``. Pass empty-string
 * values to delete a key.
 *
 * The backplane enforces an allow-list per provider so a malformed
 * request can't clobber unrelated env vars. The response is the
 * refreshed config with updated ``has_key`` booleans.
 */
export async function setSttCredentials(
  provider: Exclude<SttProvider, "local">,
  values: Record<string, string | null>,
): Promise<SttConfigResult> {
  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, values }),
    })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String((e as Error)?.message || e),
    }
  }
  return consumeConfigResponse(res)
}

/* ---------- local-model download ---------------------------------------- */

export type DownloadLocalModelResult =
  | { ok: true; model: string }
  | { ok: false; status: number; error: string }

/**
 * Eagerly pull a faster-whisper model into the HF cache so the next
 * transcription doesn't pay the cold-start download cost. The call
 * blocks until the download finishes (or the AbortSignal fires) — the
 * default ``timeoutMs`` is 20 minutes to cover large-v3 (~3 GB) on a
 * slow link. Callers that don't want any timeout should pass Infinity.
 */
export async function downloadLocalModel(
  model: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DownloadLocalModelResult> {
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000

  const controller = new AbortController()
  const onExternalAbort = () =>
    controller.abort(opts.signal?.reason ?? new DOMException("Aborted", "AbortError"))
  if (opts.signal) {
    if (opts.signal.aborted) onExternalAbort()
    else opts.signal.addEventListener("abort", onExternalAbort, { once: true })
  }
  const timer =
    Number.isFinite(timeoutMs)
      ? setTimeout(
          () => controller.abort(new DOMException("Download timed out", "TimeoutError")),
          timeoutMs,
        )
      : null

  let res: Response
  try {
    res = await backplaneFetch("/hermes/stt/local-model/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    })
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: String((e as Error)?.message || e),
    }
  } finally {
    if (timer != null) clearTimeout(timer)
    opts.signal?.removeEventListener("abort", onExternalAbort)
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* fall through */
  }
  if (!res.ok) {
    const errMsg =
      (body as { error?: string } | null)?.error ||
      `model download failed (${res.status})`
    return { ok: false, status: res.status, error: errMsg }
  }
  return { ok: true, model }
}
