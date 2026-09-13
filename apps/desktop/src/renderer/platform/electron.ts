import {
  createDshPlatformAdapters,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import type {
  PlatformAdapter,
  StorageChangeMap,
} from "@amiba/app-runtime/platform";

export function createElectronAdapter(
  dshClient?: DshApiClient,
): PlatformAdapter {
  const bridge = window.amiba;

  return {
    kind: "desktop",
    appUpdates: bridge.appUpdates,
    desktopPet: bridge.desktopPet,
    windowChrome: bridge.windowChrome,

    storage: {
      get: (keys) => bridge.storage.get(keys),
      set: (patch) => bridge.storage.set(patch),
      remove: (keys) => bridge.storage.remove(keys),
      watch: (keys, listener) => {
        const filter =
          keys === undefined ? null : Array.isArray(keys) ? keys : [keys];
        return bridge.storage.onChanged((changes: StorageChangeMap) => {
          if (filter === null) {
            listener(changes);
            return;
          }
          const filtered: StorageChangeMap = {};
          for (const k of filter) {
            if (k in changes) filtered[k] = changes[k];
          }
          if (Object.keys(filtered).length > 0) listener(filtered);
        });
      },
    },

    shell: { openExternal: (url) => bridge.shell.openExternal(url) },

    ...(dshClient ? createDshPlatformAdapters(dshClient) : {}),
    agentDiagnostics: bridge.agentDiagnostics,

    // Native workbench extensions belong to the main window, not the pet canvas.
    nativeExtensions: new URLSearchParams(window.location.search).get("desktopPet") === "1"
      ? undefined
      : bridge.nativeExtensions,

    workspaces: {
      chooseDirectory: (defaultPath) =>
        bridge.workspaces.chooseDirectory(defaultPath),
      getDefaultRoot: () => bridge.workspaces.getDefaultRoot(),
      bind: (sessionId, p) => bridge.workspaces.bind(sessionId, p),
      bindIfUnbound: (sessionId, p) => bridge.workspaces.bindIfUnbound(sessionId, p),
      resolveRuntimeCwd: (sessionId, cwd) => bridge.workspaces.resolveRuntimeCwd(sessionId, cwd),
      unbind: (sessionId) => bridge.workspaces.unbind(sessionId),
      getCurrent: (sessionId) => bridge.workspaces.getCurrent(sessionId),
      listBindings: () => bridge.workspaces.listBindings(),
      onChange: (cb) => bridge.workspaces.onChanged(cb),
    },

    workspaceFiles: {
      list: (sessionId, path) => bridge.files.tree(sessionId, path),
      search: (sessionId, query) => bridge.files.search(sessionId, query),
      read: (sessionId, path) => bridge.files.read(sessionId, path),
      readBytes: (sessionId, path) => bridge.files.readBytes(sessionId, path),
      reveal: (sessionId, path) => bridge.files.reveal(sessionId, path),
      openExternal: (sessionId, path) =>
        bridge.files.openExternal(sessionId, path),
      watch: (sessionId, paths, listener) =>
        bridge.files.watch(sessionId, paths, listener),
    },

    workspaceDevelopment: bridge.workspaceDevelopment,
  };
}
