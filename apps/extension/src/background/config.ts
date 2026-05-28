/**
 * Background SW configuration. Endpoints + storage keys + default model
 * are sourced from @hermes-x/core (shared with desktop). Extension-only
 * constants (alarms, heartbeat timing, agent-window config, userscript
 * update cadence) live in this file.
 */
export {
  BRIDGE_URL,
  BRIDGE_URL_STORAGE_KEY,
  BACKPLANE_HTTP_BASE,
  BACKPLANE_KEY_STORAGE_KEY,
  ATTACHMENT_HTTP_BASE,
  DEFAULT_HERMES_API_BASE,
  DEFAULT_HERMES_MODEL,
} from "@hermes-x/core";

export const RECONNECT_MS = 3000;

// MV3 SWs idle out after 30s of no activity. Since Chrome 116, WebSocket
// message activity resets that timer, so a ~20s heartbeat keeps both the SW
// and the WS alive indefinitely.
export const HEARTBEAT_MS = 20_000;

/**
 * Maximum interval the SW will tolerate between inbound frames before
 * deciding the bridge has gone silent and the WebSocket is half-open.
 * Three heartbeats with no traffic of any kind triggers a recycle: close
 * the WS (which flips `readyState` to CLOSED, fires onclose, and lets the
 * normal reconnect path take over). Tighter than the OS TCP keepalive
 * default (hours) and loose enough that transient slowness doesn't false
 * positive. See `bridge.ts:startHeartbeat`.
 */
export const HEARTBEAT_TIMEOUT_MS = HEARTBEAT_MS * 3;

export const KEEPALIVE_ALARM = "hermes-keepalive";
export const KEEPALIVE_PERIOD_MIN = 0.5;

export interface AgentWindowConfig {
  url: string;
  width: number;
  height: number;
  type: "normal" | "popup" | "panel";
  focused: boolean;
}

export const DEFAULT_AGENT_WINDOW: AgentWindowConfig = {
  url: "about:blank",
  width: 1280,
  height: 800,
  type: "normal",
  focused: false,
};

// Userscript update polling cadence. Chrome alarms minimum is 0.5 min.
export const USERSCRIPT_UPDATE_ALARM = "hermes-userscript-update";
export const USERSCRIPT_UPDATE_PERIOD_MIN = 60 * 6; // every 6 hours
