import { readdir } from "node:fs/promises"
import { join } from "node:path"

import { BrowserWindow, ipcMain, shell } from "electron"
import type { WorkspaceChange } from "@amiba/platform"

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

  // @file mention source for the desktop chat. Lists the active session's
  // bound workspace dir (top level only — recursion is a later enhancement),
  // filtered by the typed query and excluding dotfiles. Returns [] when the
  // session has no bound workspace or the dir can't be read.
  ipcMain.handle(
    "files:list",
    async (_e, args: { sessionId: string; query: string }): Promise<{ path: string; isDir: boolean }[]> => {
      const root = workspaceManager.getForSession(args.sessionId)
      if (!root) return []
      const q = (args.query || "").toLowerCase()
      try {
        const entries = await readdir(root, { withFileTypes: true })
        return entries
          .filter((e) => !e.name.startsWith("."))
          .filter((e) => e.name.toLowerCase().includes(q))
          .slice(0, 30)
          .map((e) => ({ path: join(root, e.name), isDir: e.isDirectory() }))
      } catch {
        return []
      }
    },
  )

  workspaceManager.onChange(broadcastWorkspaceChange)
}
