import {
  createDshPlatformAdapters,
  createIpcChatEngineClient,
  type ChatEngineIpcSurface,
  type DshApiClient,
} from "@amiba/app-runtime/dsh-client";
import type {
  PlatformAdapter,
  StorageChangeMap,
} from "@amiba/app-runtime/platform";
import { getPlatform } from "@amiba/app-runtime/platform";

export function createElectronAdapter(
  dshClient?: DshApiClient,
): PlatformAdapter {
  const bridge = window.amiba;
  const chatEngine = bridge.chatEngine as ChatEngineIpcSurface | undefined;

  // The hosted engine (main process) serializes this window's local
  // attachment drafts through the official renderer adapter; resolve the
  // requests against the platform at request time (the official draft
  // registry is bound by the shell after this adapter is constructed).
  if (chatEngine?.onSerializeRequest) {
    chatEngine.onSerializeRequest((request) => {
      void (async () => {
        try {
          const parts =
            (await getPlatform().agentAttachments?.serialize?.(
              request.sessionId,
              request.ids,
            )) ?? [];
          chatEngine.respondSerialize(request.requestId, true, parts);
        } catch (error) {
          chatEngine.respondSerialize(
            request.requestId,
            false,
            [],
            error instanceof Error ? error.message : String(error),
          );
        }
      })();
    });
  }

  return {
    kind: "desktop",
    appUpdates: bridge.appUpdates,
    desktopPet: bridge.desktopPet,
    windowChrome: bridge.windowChrome,
    // The main process hosts the app's one chat engine; surfaces consume it
    // instead of building their own. (The ui-shell plugin falls back to a
    // local engine when this is absent, e.g. a web host.)
    ...(chatEngine ? { chatEngine: createIpcChatEngineClient(chatEngine) } : {}),

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

    shell: {
      openExternal: (url) => bridge.shell.openExternal(url),
      closeWindow: () => bridge.window.close(),
    },

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
      observe: (sessionId, path, changed) => bridge.files.observe(sessionId, path, changed),
      stat: (sessionId, path) => bridge.files.stat(sessionId, path),
      readBytes: (sessionId, path) => bridge.files.readBytes(sessionId, path),
      readDocument: (sessionId, path, request) => bridge.files.readDocument(sessionId, path, request),
      reveal: (sessionId, path) => bridge.files.reveal(sessionId, path),
      openExternal: (sessionId, path) =>
        bridge.files.openExternal(sessionId, path),
      watch: (sessionId, paths, listener) =>
        bridge.files.watch(sessionId, paths, listener),
    },

    workspaceDevelopment: bridge.workspaceDevelopment,
  };
}
