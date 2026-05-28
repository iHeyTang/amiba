/**
 * Endpoints + storage keys shared by extension and desktop.
 *
 * Both apps talk to the same local Hermes infrastructure:
 *   - hermes-plugin-http-backplane (BACKPLANE_HTTP_BASE)
 *   - hermes-plugin-browser-tools  (BRIDGE_URL — websocket hub)
 *   - hermes-agent gateway         (DEFAULT_HERMES_API_BASE)
 *
 * Storage keys are platform-neutral strings; each app reads/writes them
 * through `getPlatform().storage`.
 */

/**
 * WebSocket hub for `my_browser_*` tool calls. Hosted by the
 * `hermes-plugin-browser-tools` plugin (env `HERMES_BROWSER_TOOLS_PORT`,
 * default 9393). Users can override the URL in settings; the override
 * lives in storage under `BRIDGE_URL_STORAGE_KEY`.
 */
export const BRIDGE_URL = "ws://127.0.0.1:9393"
export const BRIDGE_URL_STORAGE_KEY = "settings.bridge.url"

/**
 * Local HTTP base for the `hermes-plugin-http-backplane` plugin (env
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
