/**
 * IPC bridge for gbrain operations.
 *
 * Exposes two channels:
 *   - `gbrain:health`  — unauthenticated health check (GET /health)
 *   - `gbrain:call`    — authenticated MCP tool call (POST /mcp)
 *
 * The renderer calls these via `window.hermes.gbrain.*` (see preload).
 * Connection config (baseUrl, token) is read from shared storage so
 * changes in the Settings UI take effect without restarting the app.
 */

import { ipcMain } from "electron"
import {
  BRAIN_DEFAULT_URL,
  BRAIN_TOKEN_STORAGE_KEY,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"

import { GBrainClient, type GBrainHealthResult } from "./client"
import { mainStore } from "../storage"

let client: GBrainClient | null = null

/**
 * Read current config from storage and ensure the client is configured.
 * Returns null if no URL is configured yet.
 */
async function getClient(): Promise<GBrainClient | null> {
  const stored = await mainStore.get([
    BRAIN_URL_STORAGE_KEY,
    BRAIN_TOKEN_STORAGE_KEY,
  ])
  const url =
    typeof stored[BRAIN_URL_STORAGE_KEY] === "string"
      ? (stored[BRAIN_URL_STORAGE_KEY] as string).trim()
      : ""
  const token =
    typeof stored[BRAIN_TOKEN_STORAGE_KEY] === "string"
      ? (stored[BRAIN_TOKEN_STORAGE_KEY] as string).trim()
      : ""

  if (!url) return null

  if (!client) {
    client = new GBrainClient({
      baseUrl: url || BRAIN_DEFAULT_URL,
      token,
    })
  } else {
    client.configure({
      baseUrl: url || BRAIN_DEFAULT_URL,
      token,
    })
  }
  return client
}

export function registerGBrainHandlers(): void {
  // Health check — doesn't need auth, just needs the URL
  ipcMain.handle(
    "gbrain:health",
    async (): Promise<GBrainHealthResult | null> => {
      const c = await getClient()
      if (!c) return null
      return c.health()
    },
  )

  // Generic MCP tool call
  ipcMain.handle(
    "gbrain:call",
    async (
      _event,
      { tool, args }: { tool: string; args?: Record<string, unknown> },
    ): Promise<unknown> => {
      const c = await getClient()
      if (!c) {
        throw new Error(
          "gbrain not configured — set URL and token in Settings → Brain",
        )
      }
      return c.call(tool, args)
    },
  )
}
