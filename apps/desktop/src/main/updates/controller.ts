export type UpdateState = {
  // `available`/`downloaded` belong to the electron-updater path, which
  // downloads as soon as it sees a release. Builds that cannot install in place
  // (unsigned macOS) use `offered → downloading → ready` instead: detection and
  // downloading are still ours, installing is handed to the user.
  status: "idle" | "disabled" | "checking" | "available" | "offered" | "downloading" | "downloaded" | "ready" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  error?: string;
};

// Kept independent from Electron so race and fallback behavior can be tested.
export function createUpdateController({ updater, sources, currentVersion, notify, quit }: {
  updater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
    allowDowngrade: boolean;
    on(event: string, listener: (...args: any[]) => void): unknown;
    setFeedURL(options: { provider: "generic"; url: string; channel: string }): void;
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
  };
  sources: string[];
  currentVersion: string;
  notify: (state: UpdateState) => void;
  quit: () => void;
}) {
  let state: UpdateState = { status: sources.length ? "idle" : "disabled", currentVersion };
  let active: Promise<UpdateState> | undefined;
  let installRequested = false;
  updater.autoDownload = false;
  // Installation is explicit so runtime shutdown can finish before replacing files.
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  const emit = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    notify({ ...state });
  };
  updater.on("error", () => {}); // Promises below own errors and source fallback.
  updater.on("update-available", (info: { version: string }) => emit({ status: "available", version: info.version }));
  updater.on("update-not-available", () => emit({ status: "idle", version: undefined }));
  updater.on("download-progress", (progress: { percent: number }) => emit({ status: "downloading", percent: progress.percent }));
  updater.on("update-downloaded", (info: { version: string }) => emit({ status: "downloaded", version: info.version, percent: 100 }));

  async function run(channel: string) {
    let lastError: unknown;
    for (const url of sources) {
      emit({ status: "checking", error: undefined, version: undefined, percent: undefined });
      try {
        updater.setFeedURL({ provider: "generic", url, channel });
        await updater.checkForUpdates();
        if (state.status === "available") {
          emit({ status: "downloading", percent: 0 });
          await updater.downloadUpdate();
        }
        return { ...state };
      } catch (error) { lastError = error; }
    }
    emit({ status: "error", error: lastError instanceof Error ? lastError.message : String(lastError) });
    return { ...state };
  }
  return {
    getState: () => ({ ...state }),
    check(channel: string): Promise<UpdateState> {
      if (active) return active;
      if (state.status === "disabled" || state.status === "downloaded") return Promise.resolve({ ...state });
      active = run(channel).finally(() => { active = undefined; });
      return active;
    },
    install() {
      if (state.status !== "downloaded") throw new Error("No verified update is ready to install");
      if (installRequested) return;
      installRequested = true;
      try { quit(); } catch (error) { installRequested = false; throw error; }
    },
  };
}
