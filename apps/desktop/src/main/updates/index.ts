import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { createUpdateController } from "./controller";

let installPending = false;

export function finishPendingUpdate(): boolean {
  if (!installPending) return false;
  installPending = false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

export function registerAppUpdates() {
  let sources: string[] = [];
  if (app.isPackaged && ["darwin", "win32"].includes(process.platform)) {
    try {
      const config = JSON.parse(readFileSync(path.join(process.resourcesPath, "release-config.json"), "utf8"));
      if (!Array.isArray(config.sources)) throw new Error("Invalid update source configuration");
      sources = config.sources.map((source: string) => {
        const url = new URL(source);
        if (url.protocol !== "https:" || url.username || url.password) throw new Error("Update sources must use HTTPS without credentials");
        return url.href;
      });
    } catch (error) { console.error("[updates] disabled:", error); }
  }
  const controller = createUpdateController({
    updater: autoUpdater,
    sources,
    currentVersion: app.getVersion(),
    notify: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send("app-updates:changed", state);
      }
    },
    quit: () => { installPending = true; app.quit(); },
  });
  const check = () => controller.check(`latest-${process.arch}`);
  ipcMain.handle("app-updates:state", () => controller.getState());
  ipcMain.handle("app-updates:check", check);
  ipcMain.handle("app-updates:install", () => controller.install());
  const initial = setTimeout(() => { void check(); }, 30_000);
  const interval = setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
  initial.unref();
  interval.unref();
  app.once("before-quit", () => { clearTimeout(initial); clearInterval(interval); });
}
