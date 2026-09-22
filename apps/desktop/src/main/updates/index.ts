import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { createUpdateController, type UpdateState } from "./controller";
import { createManualUpdateController } from "./manual";
import { fetchLatestRelease } from "./github-release";
import { downloadVerified, pruneInstallers } from "./download";
import { openInstallerAfterExit } from "./handoff";
import { scheduleUpdateChecks } from "./schedule";

// Both halves must start with an alphanumeric character, so a value such as
// `../etc` cannot rewrite the API path it is interpolated into.
const REPOSITORY = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/** The operations the renderer can ask of whichever update path is live. */
type UpdateHost = {
  getState: () => UpdateState;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  cancel: () => Promise<UpdateState>;
  install: () => void;
};

let installPending = false;

export function finishPendingUpdate(): boolean {
  if (!installPending) return false;
  installPending = false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

/**
 * Read `release-config.json` from the packaged resources.
 *
 * `sources` feeds electron-updater. `manual.repository` is written instead when
 * the build cannot install in place (see the unsigned macOS release path in
 * scripts/release): the app then offers the download and hands installation to
 * the user. Both fields are refused unless they are HTTPS-only.
 */
function readReleaseConfig(): { sources: string[]; repository?: string } {
  if (!app.isPackaged) return { sources: [] };
  try {
    const config = JSON.parse(readFileSync(path.join(process.resourcesPath, "release-config.json"), "utf8"));
    if (!Array.isArray(config.sources)) throw new Error("Invalid update source configuration");
    const sources = config.sources.map((source: string) => {
      const url = new URL(source);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Update sources must use HTTPS without credentials");
      return url.href;
    });
    const repository = typeof config.manual?.repository === "string" && REPOSITORY.test(config.manual.repository)
      ? config.manual.repository
      : undefined;
    return { sources, repository };
  } catch (error) {
    console.error("[updates] disabled:", error);
    return { sources: [] };
  }
}

function createUpdateHost(
  { sources, repository }: { sources: string[]; repository?: string },
  currentVersion: string,
  notify: (state: UpdateState) => void,
): UpdateHost {
  // Unsigned macOS builds are the reason this branch exists: Squirrel.Mac
  // verifies the signature of whatever replaces the bundle, and an ad-hoc
  // signature gives it nothing to verify. Detection and downloading need no
  // signature, so those still happen here and only the install step is manual.
  if (!sources.length && repository && process.platform === "darwin") {
    const manual = createManualUpdateController({
      currentVersion,
      assetName: (version) => `Amiba-${version}-mac-${process.arch}.dmg`,
      fetchRelease: () => fetchLatestRelease(repository),
      download: async (asset, onProgress, signal) => {
        const directory = path.join(app.getPath("userData"), "updates");
        const result = await downloadVerified({
          url: asset.url,
          sha256: asset.sha256,
          size: asset.size,
          filePath: path.join(directory, asset.name),
        }, { onProgress, signal });
        // Superseded installers are dead weight once the new one is verified.
        await pruneInstallers(directory, asset.name);
        return result;
      },
      install: (filePath) => openInstallerAfterExit(filePath, () => app.quit()),
      notify,
    });
    return {
      getState: () => manual.getState(),
      check: () => manual.check(),
      download: () => manual.download(),
      cancel: () => manual.cancel(),
      install: () => manual.install(),
    };
  }

  const legacy = createUpdateController({
    updater: autoUpdater,
    sources,
    currentVersion,
    notify,
    quit: () => { installPending = true; app.quit(); },
  });
  return {
    getState: () => legacy.getState(),
    check: () => legacy.check(`latest-${process.arch}`),
    // Explicit retry after cancellation; periodic checks only detect that version.
    download: () => legacy.check(`latest-${process.arch}`, true),
    cancel: () => legacy.cancel(),
    install: () => legacy.install(),
  };
}

export function registerAppUpdates() {
  const host = createUpdateHost(readReleaseConfig(), app.getVersion(), (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("app-updates:changed", state);
    }
  });
  const check = () => host.check();
  ipcMain.handle("app-updates:state", () => host.getState());
  ipcMain.handle("app-updates:check", check);
  ipcMain.handle("app-updates:download", () => host.download());
  ipcMain.handle("app-updates:cancel", () => host.cancel());
  ipcMain.handle("app-updates:install", () => host.install());
  const schedule = scheduleUpdateChecks(check);
  const onFocus = () => { void schedule.checkIfDue(); };
  app.on("browser-window-focus", onFocus);
  app.once("before-quit", () => {
    schedule.dispose();
    app.removeListener("browser-window-focus", onFocus);
  });
}
