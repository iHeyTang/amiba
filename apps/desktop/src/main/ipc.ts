import { BrowserWindow, ipcMain, shell } from "electron"
import type { WorkspaceChange } from "@hermes-x/platform"

import { mainStore, type StorageChangeMap } from "./storage"
import { workspaceManager } from "./workspace"

function broadcastChange(changes: StorageChangeMap) {
  if (Object.keys(changes).length === 0) return
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue
    win.webContents.send("storage:changed", changes)
  }
}

function broadcastWorkspaceChange(change: WorkspaceChange) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue
    win.webContents.send("workspace:changed", change)
  }
}

export function registerIpcHandlers() {
  // Storage handlers route to the shared `mainStore`, the same instance the
  // main-process PlatformAdapter uses. Renderer writes and main-side reads
  // therefore see the same state.
  ipcMain.handle("storage:get", (_e, keys?: string | string[]) => mainStore.get(keys))
  ipcMain.handle("storage:set", (_e, patch: Record<string, unknown>) => mainStore.set(patch))
  ipcMain.handle("storage:remove", (_e, keys: string | string[]) => mainStore.remove(keys))

  // Any mutation (renderer- or main-initiated) gets broadcast to every
  // renderer so `storage.watch()` works across surfaces. The bus runs in
  // process — no fs.watch — so the listener fires synchronously after the
  // store finishes its persist().
  mainStore.watch(broadcastChange)

  ipcMain.handle("shell:open-external", (_e, url: string) => shell.openExternal(url))

  ipcMain.handle(
    "workspace:bind",
    (_e, args: { sessionId: string; path: string }) =>
      workspaceManager.bind(args.sessionId, args.path),
  )
  ipcMain.handle("workspace:unbind", (_e, sessionId: string) =>
    workspaceManager.unbind(sessionId),
  )
  ipcMain.handle("workspace:get-current", (_e, sessionId: string) =>
    workspaceManager.getForSession(sessionId),
  )
  workspaceManager.onChange(broadcastWorkspaceChange)
}
