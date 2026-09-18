/**
 * Main-process DSH API proxy ("会话数据面").
 *
 * The renderer platform adapters (`agentSessions`, `agentWorkspaces`,
 * `agentModels`, presets/settings/credentials/permissions/skills/commands)
 * are executed HERE, in the main process, on the main process's single
 * DshApiClient — the same `createDshPlatformAdapters` factory the renderer
 * used to run with a window-local client. Windows dispatch one generic
 * `dsh-api:call { adapter, method, args }` invoke and receive the result;
 * this lets a window be a pure view even for conversation data (session
 * history reads open their `session/follow` streams in main, not in the
 * window).
 *
 * `agentAttachments` is deliberately NOT proxied: the official attachment
 * draft registry is bound per-renderer by the DSH Web Shell, and draft bytes
 * never leave the window that owns them.
 */

import { ipcMain } from "electron";
import {
  createDshPlatformAdapters,
  type DshPlatformAdapters,
} from "@amiba/app-runtime/dsh-client";
import { dshRuntime } from "./dsh-runtime";

interface DshApiCall {
  adapter: string;
  method: string;
  args: unknown[];
}

const PROXIED_ADAPTERS = [
  "agentModels",
  "agentSessions",
  "agentWorkspaces",
  "agentPresets",
  "agentSettings",
  "agentCredentials",
  "agentPermissions",
  "agentSkills",
  "agentCommands",
] as const;

export class DshApiProxy {
  private adapters: DshPlatformAdapters | null = null;
  private started = false;

  /** Register the IPC surface (idempotent). Call once at app ready. */
  start(): void {
    if (this.started) return;
    this.started = true;
    ipcMain.handle("dsh-api:call", async (_event, request: DshApiCall) => {
      const adapters = await this.ensure();
      const { adapter, method, args } = request ?? {};
      if (
        typeof adapter !== "string" ||
        !(PROXIED_ADAPTERS as readonly string[]).includes(adapter) ||
        typeof method !== "string"
      ) {
        throw new Error(`Invalid DSH API proxy call: ${String(adapter)}.${String(method)}`);
      }
      const target = adapters[adapter as (typeof PROXIED_ADAPTERS)[number]];
      const fn = (target as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") {
        throw new Error(`Unknown DSH API method: ${adapter}.${method}`);
      }
      // `bind` so methods that consult `this` (permission presets read their
      // own defaults) keep their receiver in the main process.
      return (fn as (this: unknown, ...values: unknown[]) => unknown).apply(
        target,
        Array.isArray(args) ? args : [],
      );
    });
  }

  private async ensure(): Promise<DshPlatformAdapters> {
    if (this.adapters) return this.adapters;
    const { client } = await dshRuntime.ensureStarted();
    // The same factory the renderer used with a window-local client, now
    // bound to the main process's single client. Its `agentAttachments`
    // member is never dispatched (see the header note).
    this.adapters = createDshPlatformAdapters(client);
    return this.adapters;
  }

  dispose(): void {
    this.started = false;
    this.adapters = null;
  }
}

export const dshApiProxy = new DshApiProxy();