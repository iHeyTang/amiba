import type { MainActivate } from "@hermes-x/extension-api"

/**
 * Main process entry for {{NAME}}.
 *
 * This file runs in the Electron main process. Use host.ipc.expose() to
 * expose IPC handlers that the renderer can call via host.ipc.invoke().
 */
export const activate: MainActivate = async (_host) => {
  // No-op for now. Add host.ipc.expose() calls here as needed.
}
