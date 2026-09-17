import { app, BrowserWindow, ipcMain } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import { createUpdateController, type UpdateState } from "./controller";
import { createManualUpdateController } from "./manual";
import { fetchLatestRelease } from "./github-release";
import { downloadVerified, pruneInstallers } from "./download";
import { openInstallerAfterExit } from "./handoff";

// Both halves must start with an alphanumeric character, so a value such as
// `../etc` cannot rewrite the API path it is interpolated into.
const REPOSITORY = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;

/** The four operations the renderer can ask of whichever update path is live. */
type UpdateHost = {
  getState: () => UpdateState;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
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
      download: async (asset, onProgress) => {
        const directory = path.join(app.getPath("userData"), "updates");
        const result = await downloadVerified({
          url: asset.url,
          sha256: asset.sha256,
          size: asset.size,
          filePath: path.join(directory, asset.name),
        }, { onProgress });
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
    // electron-updater downloads as soon as it sees a release; the renderer only
    // reaches for this on builds that ask first.
    download: () => Promise.resolve(legacy.getState()),
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
  ipcMain.handle("app-updates:install", () => host.install());
  const initial = setTimeout(() => { void check(); }, 30_000);
  const interval = setInterval(() => { void check(); }, 6 * 60 * 60 * 1000);
  initial.unref();
  interval.unref();
  app.once("before-quit", () => { clearTimeout(initial); clearInterval(interval); });
}
