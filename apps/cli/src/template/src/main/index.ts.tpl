import type { MainActivate } from "@amiba/extension-api"

export const activate: MainActivate = async (host) => {
  host.logger.info("[{{ID}}] activated")
  // TODO: register IPC handlers via host.ipc.expose(...)
  // TODO: register lifecycle hooks via host.lifecycle.onBootBackground(...)
}
