import { readPreviewFile } from "./file-preview";
import { resolve as resolvePath } from "node:path";

import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
} from "electron";
import type {
  WorkspaceChange,
  WorkspaceCheckpointOptions,
} from "@amiba/app-runtime/platform";

import { mainStore, type StorageChangeMap } from "./storage";
import { dshRuntime, managedDshPaths } from "./dsh-runtime";
import {
  loadDshClientBoot,
  proxyDshClientFetch,
  resolveDshSessionDownloadUrl,
  type DshProxyRequest,
} from "./dsh-client-boot";
import { dshDiagnostics } from "./dsh-diagnostics";
import { DshProfilePluginManager } from "./dsh-profile-plugins";
import { workspaceManager } from "./workspace";
import {
  addWorkspaceProjectFolder,
  bindWorkspaceProjectLocation,
  createWorkspaceCheckpoint,
  createWorkspaceProject,
  createWorkspaceWorktree,
  deleteWorkspaceCheckpoint,
  ensureWorkspaceProject,
  getWorkspaceGitDiff,
  getWorkspaceGitState,
  getWorkspaceTerminal,
  listWorkspaceTerminals,
  listWorkspaceCheckpoints,
  markWorkspaceCheckpointChanged,
  listWorkspaceProjects,
  listWorkspaceTree,
  listWorkspaceWorktrees,
  mutateWorkspaceGit,
  resizeWorkspaceTerminal,
  restoreWorkspaceCheckpoint,
  searchWorkspaceTree,
  startWorkspaceTerminal,
  stopWorkspaceTerminal,
  writeWorkspaceTerminal,
} from "./workspace-development";


interface FileWatchSubscription {
  webContentsId: number;
  sessionId: string;
  paths: Set<string>;
}

const fileWatchSubscriptions = new Map<string, FileWatchSubscription>();
const observedFileWatchSenders = new Set<number>();

async function readWorkspaceFile(sessionId: string, candidate: string, raw = false) {
  const resolved = await workspaceManager.resolveFileForSession(sessionId, candidate);
  return readPreviewFile(resolved, raw);
}

function broadcastChange(changes: StorageChangeMap) {
  if (Object.keys(changes).length === 0) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send("storage:changed", changes);
  }
}

function broadcastWorkspaceChange(change: WorkspaceChange) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send("workspace:changed", change);
  }
}

export function registerIpcHandlers() {
  const dshProfilePlugins = new DshProfilePluginManager({
    paths: managedDshPaths(),
    runtime: dshRuntime,
  });

  // DSH Client Web Shell boot + Electron transport seam. The graph is
  // composed by DSH's client-modules service; Electron only carries it across
  // the isolated preload boundary and forwards API fetches from a file origin.
  ipcMain.handle("dsh-client:boot", () => loadDshClientBoot(dshRuntime));
  ipcMain.handle(
    "dsh-client:fetch",
    (_event, request: DshProxyRequest) =>
      proxyDshClientFetch(dshRuntime, request),
  );

  ipcMain.handle("dsh-client:download", async (event, rawUrl: string) => {
    const { baseUrl } = await dshRuntime.ensureStarted();
    const target = resolveDshSessionDownloadUrl(rawUrl, baseUrl);
    // Native downloads have no file-page Origin or cross-site fetch metadata.
    // The Host still enforces its normal authority checks and streams the ZIP.
    event.sender.session.downloadURL(target.href, { headers: { Origin: target.origin } });
  });

  // The Plugins Client contribution owns the product workflow. Electron only
  // supplies the native file picker and the process boundary required to run
  // DSH's official profile plugin command while its Host is stopped.
  ipcMain.handle("dsh-plugins:list", () => dshProfilePlugins.list());
  ipcMain.handle("dsh-plugins:install-registry", (_event, spec: string) =>
    dshProfilePlugins.installRegistry(spec),
  );
  ipcMain.handle("dsh-plugins:install-archive", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "DSH plugin package", extensions: ["tgz"] }],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const filename = result.canceled ? undefined : result.filePaths[0];
    return filename ? dshProfilePlugins.installArchive(filename) : null;
  });
  ipcMain.handle("dsh-plugins:remove", (_event, packageName: string) =>
    dshProfilePlugins.remove(packageName),
  );
  ipcMain.handle("dsh-plugins:update", (_event, packageName: string) =>
    dshProfilePlugins.update(packageName),
  );

  // Storage handlers route to the shared `mainStore`, the same instance the
  // main-process PlatformAdapter uses. Renderer writes and main-side reads
  // therefore see the same state.
  ipcMain.handle("storage:get", (_e, keys?: string | string[]) =>
    mainStore.get(keys),
  );
  ipcMain.handle("storage:set", (_e, patch: Record<string, unknown>) =>
    mainStore.set(patch),
  );
  ipcMain.handle("storage:remove", (_e, keys: string | string[]) =>
    mainStore.remove(keys),
  );

  // Any mutation (renderer- or main-initiated) gets broadcast to every
  // renderer so `storage.watch()` works across surfaces. The bus runs in
  // process — no fs.watch — so the listener fires synchronously after the
  // store finishes its persist().
  mainStore.watch(broadcastChange);

  ipcMain.handle("shell:open-external", (_e, url: string) =>
    shell.openExternal(url),
  );

  ipcMain.handle("agent-diagnostics:status", () => dshDiagnostics.status());
  ipcMain.handle("agent-diagnostics:restart", () => dshDiagnostics.restart());
  ipcMain.handle(
    "agent-diagnostics:logs",
    (
      _event,
      input?: Parameters<
        import("@amiba/app-runtime/platform").AgentDiagnosticsAdapter["logs"]
      >[0],
    ) => dshDiagnostics.logs(input),
  );

  ipcMain.handle(
    "workspace:choose-directory",
    async (event, defaultPath?: string): Promise<string | null> => {
      const options: OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  );

  ipcMain.handle(
    "workspace:bind",
    (_e, args: { sessionId: string; path: string }) =>
      workspaceManager.bind(args.sessionId, args.path),
  );
  ipcMain.handle("workspace:unbind", (_e, sessionId: string) =>
    workspaceManager.unbind(sessionId),
  );
  ipcMain.handle("workspace:get-default-root", () =>
    workspaceManager.getDefaultRoot(),
  );
  ipcMain.handle("workspace:get-current", (_e, sessionId: string) =>
    workspaceManager.getForSession(sessionId),
  );
  ipcMain.handle("workspace:list-bindings", () =>
    workspaceManager.listBindings(),
  );
  ipcMain.handle("workspace:projects:list", () => listWorkspaceProjects());
  ipcMain.handle("workspace:projects:ensure", (_e, sessionId: string) =>
    ensureWorkspaceProject(sessionId),
  );
  ipcMain.handle(
    "workspace:projects:create",
    (_e, input: { name: string; folders: string[] }) =>
      createWorkspaceProject(input.name, input.folders),
  );
  ipcMain.handle(
    "workspace:projects:add-folder",
    (_e, input: { projectId: string; folder: string }) =>
      addWorkspaceProjectFolder(input.projectId, input.folder),
  );
  ipcMain.handle(
    "workspace:projects:bind-location",
    (_e, input: { sessionId: string; projectId: string; path: string }) =>
      bindWorkspaceProjectLocation(
        input.sessionId,
        input.projectId,
        input.path,
      ),
  );
  ipcMain.handle("workspace:worktrees:list", (_e, sessionId: string) =>
    listWorkspaceWorktrees(sessionId),
  );
  ipcMain.handle(
    "workspace:worktrees:create",
    (_e, input: { sessionId: string; branch: string; baseRef?: string }) =>
      createWorkspaceWorktree(input.sessionId, input.branch, input.baseRef),
  );
  ipcMain.handle("workspace:git:status", (_e, sessionId: string) =>
    getWorkspaceGitState(sessionId),
  );
  ipcMain.handle(
    "workspace:git:diff",
    (_e, input: { sessionId: string; staged?: boolean; paths?: string[] }) =>
      getWorkspaceGitDiff(input.sessionId, input),
  );
  ipcMain.handle(
    "workspace:git:stage",
    (_e, input: { sessionId: string; paths?: string[] }) =>
      mutateWorkspaceGit(input.sessionId, "stage", input),
  );
  ipcMain.handle(
    "workspace:git:unstage",
    (_e, input: { sessionId: string; paths?: string[] }) =>
      mutateWorkspaceGit(input.sessionId, "unstage", input),
  );
  ipcMain.handle(
    "workspace:git:commit",
    (_e, input: { sessionId: string; message: string }) =>
      mutateWorkspaceGit(input.sessionId, "commit", input),
  );
  ipcMain.handle(
    "workspace:git:ship",
    (_e, input: { sessionId: string; remote?: string }) =>
      mutateWorkspaceGit(input.sessionId, "ship", input),
  );
  ipcMain.handle("workspace:checkpoints:list", (_e, sessionId: string) =>
    listWorkspaceCheckpoints(sessionId),
  );
  ipcMain.handle(
    "workspace:checkpoints:create",
    (
      _e,
      input: {
        sessionId: string;
        label: string;
        options?: WorkspaceCheckpointOptions;
      },
    ) => createWorkspaceCheckpoint(input.sessionId, input.label, input.options),
  );
  ipcMain.handle(
    "workspace:checkpoints:mark-changed",
    (_e, input: { sessionId: string; checkpointId: string }) =>
      markWorkspaceCheckpointChanged(input.sessionId, input.checkpointId),
  );
  ipcMain.handle(
    "workspace:checkpoints:restore",
    (_e, input: { sessionId: string; checkpointId: string }) =>
      restoreWorkspaceCheckpoint(input.sessionId, input.checkpointId),
  );
  ipcMain.handle(
    "workspace:checkpoints:delete",
    (_e, input: { sessionId: string; checkpointId: string }) =>
      deleteWorkspaceCheckpoint(input.sessionId, input.checkpointId),
  );
  ipcMain.handle(
    "workspace:terminal:start",
    (_e, input: { sessionId: string; terminalId: string }) =>
      startWorkspaceTerminal(input.sessionId, input.terminalId),
  );
  ipcMain.handle("workspace:terminal:list", (_e, sessionId: string) =>
    listWorkspaceTerminals(sessionId),
  );
  ipcMain.handle(
    "workspace:terminal:get",
    (_e, input: { sessionId: string; terminalId: string }) =>
      getWorkspaceTerminal(input.sessionId, input.terminalId),
  );
  ipcMain.on(
    "workspace:terminal:write",
    (_e, input: { sessionId: string; terminalId: string; text: string }) => {
      writeWorkspaceTerminal(input.sessionId, input.terminalId, input.text);
    },
  );
  ipcMain.on(
    "workspace:terminal:resize",
    (
      _e,
      input: {
        sessionId: string;
        terminalId: string;
        columns: number;
        rows: number;
      },
    ) => {
      resizeWorkspaceTerminal(
        input.sessionId,
        input.terminalId,
        input.columns,
        input.rows,
      );
    },
  );
  ipcMain.handle(
    "workspace:terminal:stop",
    (_e, input: { sessionId: string; terminalId: string }) =>
      stopWorkspaceTerminal(input.sessionId, input.terminalId),
  );

  // @file mention source for the desktop chat. It uses the same bounded,
  // recursive workspace index as the files pane so nested files are directly
  // discoverable without letting a large repository flood the renderer.
  ipcMain.handle(
    "files:list",
    async (
      _e,
      args: { sessionId: string; query: string },
    ): Promise<{ path: string; isDir: boolean }[]> => {
      try {
        const entries = await searchWorkspaceTree(args.sessionId, args.query);
        return entries
          .slice(0, 30)
          .map((entry) => ({ path: entry.path, isDir: entry.isDirectory }));
      } catch {
        return [];
      }
    },
  );
  ipcMain.handle(
    "files:tree",
    (_e, args: { sessionId: string; path?: string }) =>
      listWorkspaceTree(args.sessionId, args.path),
  );
  ipcMain.handle(
    "files:search",
    (_e, args: { sessionId: string; query: string }) =>
      searchWorkspaceTree(args.sessionId, args.query),
  );

  ipcMain.handle(
    "files:read",
    (_e, args: { sessionId: string; path: string }) =>
      readWorkspaceFile(args.sessionId, args.path),
  );

  ipcMain.handle("files:read-bytes", (_e, args: { sessionId: string; path: string }) => readWorkspaceFile(args.sessionId, args.path, true));

  ipcMain.handle(
    "files:reveal",
    async (_e, args: { sessionId: string; path: string }): Promise<void> => {
      const resolved = await workspaceManager.resolveFileForSession(
        args.sessionId,
        args.path,
      );
      shell.showItemInFolder(resolved.path);
    },
  );

  ipcMain.handle(
    "files:open-external",
    async (_e, args: { sessionId: string; path: string }): Promise<void> => {
      const resolved = await workspaceManager.resolveFileForSession(
        args.sessionId,
        args.path,
      );
      const error = await shell.openPath(resolved.path);
      if (error) throw new Error(error);
    },
  );

  ipcMain.handle(
    "files:watch",
    async (
      event,
      args: { subscriptionId: string; sessionId: string; paths: string[] },
    ): Promise<void> => {
      if (!args.subscriptionId || !args.sessionId) {
        throw new Error("Invalid file watch subscription.");
      }
      const paths = new Set<string>();
      for (const candidate of args.paths.slice(0, 32)) {
        try {
          const resolved = await workspaceManager.resolveFileForSession(
            args.sessionId,
            candidate,
          );
          paths.add(resolved.path);
        } catch {
          // A file can disappear between read and watch registration. The
          // viewer already owns the corresponding missing-file state.
        }
      }
      fileWatchSubscriptions.set(args.subscriptionId, {
        webContentsId: event.sender.id,
        sessionId: args.sessionId,
        paths,
      });
      if (observedFileWatchSenders.has(event.sender.id)) return;
      observedFileWatchSenders.add(event.sender.id);
      event.sender.once("destroyed", () => {
        observedFileWatchSenders.delete(event.sender.id);
        for (const [id, subscription] of fileWatchSubscriptions) {
          if (subscription.webContentsId === event.sender.id) {
            fileWatchSubscriptions.delete(id);
          }
        }
      });
    },
  );

  ipcMain.handle("files:unwatch", (event, subscriptionId: string): void => {
    const subscription = fileWatchSubscriptions.get(subscriptionId);
    if (subscription?.webContentsId === event.sender.id) {
      fileWatchSubscriptions.delete(subscriptionId);
    }
  });

  workspaceManager.onChange(broadcastWorkspaceChange);
  workspaceManager.onFile((change) => {
    const changedPath = resolvePath(change.path);
    for (const [subscriptionId, subscription] of fileWatchSubscriptions) {
      if (subscription.sessionId !== change.sessionId) continue;
      if (
        !subscription.paths.has(change.path) &&
        !subscription.paths.has(changedPath)
      ) {
        continue;
      }
      const target = BrowserWindow.getAllWindows()
        .map((win) => win.webContents)
        .find((contents) => contents.id === subscription.webContentsId);
      if (!target || target.isDestroyed()) {
        fileWatchSubscriptions.delete(subscriptionId);
        continue;
      }
      target.send("files:changed", { ...change, subscriptionId });
    }
  });
}
