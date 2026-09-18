/**
 * Structural wire types for the main-process DSH state subscriptions.
 *
 * These mirror the plugin models (`@amiba/dsh-plugin-pets/model`,
 * `@amiba/dsh-plugin-notification-hub/model`) without importing the plugin
 * packages into the desktop main process, and match the shapes the DSH
 * runtime's Typert remotes (`amibaPets/*`, `amibaNotifications/*`) accept and
 * return over `DshApiClient.call`.
 */

/** `amibaPets/list` / `amibaPets/activate` result. */
export interface DshPetLibrary {
  version: 1;
  activeId: string | null;
  pets: Array<{
    id: string;
    name: string;
    config: unknown;
    updatedAt: number;
  }>;
}

export interface DshNotificationCursor {
  epoch: string;
  revision: number;
}

export interface DshNotificationRow {
  id: string;
  timestamp: number;
  source: string;
  kind: "info" | "success" | "warning" | "error";
  activity?: boolean;
  status?:
    | "completed"
    | "failed"
    | "interrupted"
    | "waiting"
    | "thinking"
    | "responding"
    | "tooling";
  title?: string;
  body?: string;
  sessionId?: string;
  readAt?: number;
  dismissedAt?: number;
  resolvedAt?: number;
}

/** `amibaNotifications/watch` long-poll result. */
export interface DshNotificationUpdate {
  cursor: DshNotificationCursor;
  reset: boolean;
  notifications: DshNotificationRow[];
  removed: string[];
}

export interface DshSessionRow {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  parentSessionId?: string;
  agentPreset?: string;
  /** DSH session-title projection, when `session/list` carries it. */
  title?: string;
}

/**
 * Remote call result envelope. `DshApiClient.call` unwraps the transport
 * envelope but the Typert remotes still return their own `{ok, value|error}`
 * result, so every call site checks `.ok` explicitly.
 */
export type DshRemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };