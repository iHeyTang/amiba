/**
 * Endpoints + storage keys shared by extension and desktop.
 *
 * Both apps talk to the same local Hermes infrastructure:
 *   - hermes-x-plugin-http-backplane (BACKPLANE_HTTP_BASE)
 *   - hermes-x-plugin-browser-tools  (BRIDGE_URL — websocket hub)
 *   - hermes-agent gateway         (DEFAULT_HERMES_API_BASE)
 *
 * Storage keys are platform-neutral strings; each app reads/writes them
 * through `getPlatform().storage`.
 */

/**
 * WebSocket hub for `my_browser_*` tool calls. Hosted by the
 * `hermes-x-plugin-browser-tools` plugin (env `HERMES_BROWSER_TOOLS_PORT`,
 * default 9393). Users can override the URL in settings; the override
 * lives in storage under `BRIDGE_URL_STORAGE_KEY`.
 */
export const BRIDGE_URL = "ws://127.0.0.1:9393"
export const BRIDGE_URL_STORAGE_KEY = "settings.bridge.url"

/**
 * Local HTTP base for the `hermes-x-plugin-http-backplane` plugin (env
 * `HERMES_BACKPLANE_PORT`, default 9394). Hosts three lanes:
 *   - `/hermes/*`              — proxies to Hermes core
 *   - `/integrations/<name>/*` — third-party plugin routes
 *   - `/v1/*`                  — reverse-proxy to Hermes gateway
 */
export const BACKPLANE_HTTP_BASE = "http://127.0.0.1:9394"

/**
 * Storage key for the user's `HERMES_BACKPLANE_KEY` mirror. When set,
 * `backplaneFetch` injects it as `Authorization: Bearer …` on every
 * request. Empty → unauthenticated (backplane accepts loopback).
 */
export const BACKPLANE_KEY_STORAGE_KEY = "settings.backplane.key"

/** @deprecated Alias for {@link BACKPLANE_HTTP_BASE}. */
export const ATTACHMENT_HTTP_BASE = BACKPLANE_HTTP_BASE

/**
 * Hermes gateway HTTP base, OpenAI-compatible Chat Completions endpoint
 * (`gateway/platforms/api_server.py`).
 */
export const DEFAULT_HERMES_API_BASE = "http://127.0.0.1:8642/v1"

export const DEFAULT_HERMES_MODEL = "hermes-agent"

/**
 * Storage keys for the voice-input affordance. The Voice settings page
 * writes here; the chat composer reads them to decide whether to show
 * the microphone button and how to behave once a recording finishes.
 *
 * Provider / model / API keys are NOT mirrored into platform.storage.
 * They live in the user's existing ``~/.hermes/config.yaml`` (``stt.*``)
 * and ``~/.hermes/.env`` exactly as they do for the CLI. The Voice
 * settings page reads them back via ``GET /hermes/stt/status`` to
 * display what's effective — that's a read-only view, not a writer.
 */
export const VOICE_ENABLED_STORAGE_KEY = "settings.voice.enabled"
export const VOICE_AUTO_SEND_STORAGE_KEY = "settings.voice.autoSend"
export const VOICE_DEVICE_ID_STORAGE_KEY = "settings.voice.deviceId"

export interface VoicePrefs {
  enabled: boolean
  autoSend: boolean
  deviceId: string
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  enabled: false,
  autoSend: false,
  deviceId: "",
}

/**
 * The backplane HTTP/WS protocol version this client is built for.
 * If the running backplane plugin reports a different `protocol_version`,
 * surface a mismatch (see getHermesStatus).
 */
export const EXPECTED_BACKPLANE_PROTOCOL = 1

// ---------------------------------------------------------------------------
// Hand-off keys between HomeView / Settings and the chat surface
// ---------------------------------------------------------------------------
// When a non-chat surface (HomeView composer, "one-click install" button)
// wants to start a fresh chat with a prefilled message, it writes the
// payload here and navigates to the chat view. ChatSurface's
// `drainPendingPrompt` reads this once on mount and clears it.
export const HOME_PENDING_PROMPT_KEY = "home.pendingPrompt"
