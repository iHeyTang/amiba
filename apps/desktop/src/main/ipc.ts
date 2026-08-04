import { open, readdir, stat } from "node:fs/promises"
import { basename, join, resolve as resolvePath } from "node:path"

import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron"
import type { WorkspaceChange } from "@amiba/platform"

import { mainStore, type StorageChangeMap } from "./storage"
import { workspaceManager } from "./workspace"

const MAX_FILE_VIEW_BYTES = 2 * 1024 * 1024

interface FileWatchSubscription {
  webContentsId: number
  sessionId: string
  paths: Set<string>
}

const fileWatchSubscriptions = new Map<string, FileWatchSubscription>()
const observedFileWatchSenders = new Set<number>()

async function readWorkspaceFile(sessionId: string, candidate: string) {
  const resolved = await workspaceManager.resolveFileForSession(
    sessionId,
    candidate,
  )
  const fileStat = await stat(resolved.path)
  if (!fileStat.isFile()) {
    throw new Error("The selected workspace resource is not a file.")
  }

  const bytesToRead = Math.min(fileStat.size, MAX_FILE_VIEW_BYTES)
  const buffer = Buffer.alloc(bytesToRead)
  const handle = await open(resolved.path, "r")
  let bytesRead = 0
  try {
    if (bytesToRead > 0) {
      const result = await handle.read(buffer, 0, bytesToRead, 0)
      bytesRead = result.bytesRead
    }
  } finally {
    await handle.close()
  }

  const contentBuffer = buffer.subarray(0, bytesRead)
  const binaryProbe = contentBuffer.subarray(
    0,
    Math.min(contentBuffer.length, 8_192),
  )
  const binary = binaryProbe.includes(0)
  return {
    path: resolved.path,
    relativePath: resolved.relativePath,
    name: basename(resolved.path),
    content: binary ? "" : contentBuffer.toString("utf8"),
    size: fileStat.size,
    modifiedAt: fileStat.mtimeMs,
    revision: `${fileStat.mtimeMs}:${fileStat.size}`,
    truncated: fileStat.size > MAX_FILE_VIEW_BYTES,
    binary,
  }
}

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
    "workspace:choose-directory",
    async (event, defaultPath?: string): Promise<string | null> => {
      const options: OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
  )

  ipcMain.handle(
    "workspace:bind",
    (_e, args: { sessionId: string; path: string }) =>
      workspaceManager.bind(args.sessionId, args.path),
  )
  ipcMain.handle("workspace:unbind", (_e, sessionId: string) =>
    workspaceManager.unbind(sessionId),
  )
  ipcMain.handle("workspace:get-default-root", () =>
    workspaceManager.getDefaultRoot(),
  )
  ipcMain.handle("workspace:get-current", (_e, sessionId: string) =>
    workspaceManager.getForSession(sessionId),
  )
  ipcMain.handle("workspace:list-bindings", () => workspaceManager.listBindings())

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

  ipcMain.handle(
    "files:read",
    (_e, args: { sessionId: string; path: string }) =>
      readWorkspaceFile(args.sessionId, args.path),
  )

  ipcMain.handle(
    "files:reveal",
    async (_e, args: { sessionId: string; path: string }): Promise<void> => {
      const resolved = await workspaceManager.resolveFileForSession(
        args.sessionId,
        args.path,
      )
      shell.showItemInFolder(resolved.path)
    },
  )

  ipcMain.handle(
    "files:open-external",
    async (_e, args: { sessionId: string; path: string }): Promise<void> => {
      const resolved = await workspaceManager.resolveFileForSession(
        args.sessionId,
        args.path,
      )
      const error = await shell.openPath(resolved.path)
      if (error) throw new Error(error)
    },
  )

  ipcMain.handle(
    "files:watch",
    async (
      event,
      args: { subscriptionId: string; sessionId: string; paths: string[] },
    ): Promise<void> => {
      if (!args.subscriptionId || !args.sessionId) {
        throw new Error("Invalid file watch subscription.")
      }
      const paths = new Set<string>()
      for (const candidate of args.paths.slice(0, 32)) {
        try {
          const resolved = await workspaceManager.resolveFileForSession(
            args.sessionId,
            candidate,
          )
          paths.add(resolved.path)
        } catch {
          // A file can disappear between read and watch registration. The
          // viewer already owns the corresponding missing-file state.
        }
      }
      fileWatchSubscriptions.set(args.subscriptionId, {
        webContentsId: event.sender.id,
        sessionId: args.sessionId,
        paths,
      })
      if (observedFileWatchSenders.has(event.sender.id)) return
      observedFileWatchSenders.add(event.sender.id)
      event.sender.once("destroyed", () => {
        observedFileWatchSenders.delete(event.sender.id)
        for (const [id, subscription] of fileWatchSubscriptions) {
          if (subscription.webContentsId === event.sender.id) {
            fileWatchSubscriptions.delete(id)
          }
        }
      })
    },
  )

  ipcMain.handle("files:unwatch", (event, subscriptionId: string): void => {
    const subscription = fileWatchSubscriptions.get(subscriptionId)
    if (subscription?.webContentsId === event.sender.id) {
      fileWatchSubscriptions.delete(subscriptionId)
    }
  })

  workspaceManager.onChange(broadcastWorkspaceChange)
  workspaceManager.onFile((change) => {
    const changedPath = resolvePath(change.path)
    for (const [subscriptionId, subscription] of fileWatchSubscriptions) {
      if (subscription.sessionId !== change.sessionId) continue
      if (
        !subscription.paths.has(change.path) &&
        !subscription.paths.has(changedPath)
      ) {
        continue
      }
      const target = BrowserWindow.getAllWindows()
        .map((win) => win.webContents)
        .find((contents) => contents.id === subscription.webContentsId)
      if (!target || target.isDestroyed()) {
        fileWatchSubscriptions.delete(subscriptionId)
        continue
      }
      target.send("files:changed", { ...change, subscriptionId })
    }
  })
}
