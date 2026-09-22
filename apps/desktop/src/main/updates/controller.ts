export type UpdateState = {
  // `available`/`downloaded` belong to the electron-updater path, which
  // downloads as soon as it sees a release. Builds that cannot install in place
  // (unsigned macOS) use `offered → downloading → ready` instead: detection and
  // downloading are still ours, installing is handed to the user.
  status: "idle" | "disabled" | "checking" | "available" | "offered" | "downloading" | "cancelled" | "downloaded" | "ready" | "error";
  currentVersion: string;
  version?: string;
  percent?: number;
  error?: string;
};

// Kept independent from Electron so race and fallback behavior can be tested.
export function createUpdateController<Token extends { cancel(): void; cancelled: boolean }>({ updater, sources, currentVersion, notify, quit }: {
  updater: {
    autoDownload: boolean;
    autoInstallOnAppQuit: boolean;
    allowPrerelease: boolean;
    allowDowngrade: boolean;
    on(event: string, listener: (...args: any[]) => void): unknown;
    setFeedURL(options: { provider: "generic"; url: string; channel: string }): void;
    checkForUpdates(): Promise<{ cancellationToken?: Token } | null | void>;
    downloadUpdate(token?: Token): Promise<unknown>;
  };
  sources: string[];
  currentVersion: string;
  notify: (state: UpdateState) => void;
  quit: () => void;
}) {
  let state: UpdateState = { status: sources.length ? "idle" : "disabled", currentVersion };
  let active: Promise<UpdateState> | undefined;
  let installRequested = false;
  let downloadToken: Token | undefined;
  let cancelled = false;
  let cancelledVersion: string | undefined;
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
  updater.on("download-progress", (progress: { percent: number }) => { if (!cancelled && state.status === "downloading") emit({ percent: progress.percent }); });
  updater.on("update-downloaded", (info: { version: string }) => { if (!cancelled && state.status === "downloading") emit({ status: "downloaded", version: info.version, percent: 100 }); });

  async function run(channel: string, retryCancelled: boolean) {
    let lastError: unknown;
    for (const url of sources) {
      emit({ status: "checking", error: undefined, version: undefined, percent: undefined });
      try {
        updater.setFeedURL({ provider: "generic", url, channel });
        const result = await updater.checkForUpdates();
        downloadToken = result?.cancellationToken;
        if (state.status === "available") {
          if (!retryCancelled && state.version === cancelledVersion) {
            emit({ status: "cancelled", percent: undefined });
            return { ...state };
          }
          emit({ status: "downloading", percent: 0 });
          await updater.downloadUpdate(downloadToken);
        }
        return { ...state };
      } catch (error) {
        if (cancelled) return { ...state };
        lastError = error;
      }
    }
    emit({ status: "error", error: lastError instanceof Error ? lastError.message : String(lastError) });
    return { ...state };
  }
  return {
    getState: () => ({ ...state }),
    check(channel: string, retryCancelled = false): Promise<UpdateState> {
      if (active) return active;
      if (state.status === "disabled" || state.status === "downloaded") return Promise.resolve({ ...state });
      cancelled = false;
      active = run(channel, retryCancelled).finally(() => { active = undefined; downloadToken = undefined; });
      return active;
    },
    async cancel(): Promise<UpdateState> {
      if (state.status !== "downloading" || !downloadToken) return { ...state };
      cancelled = true;
      cancelledVersion = state.version;
      downloadToken.cancel();
      emit({ status: "cancelled", percent: undefined, error: undefined });
      // Do not allow a retry until the old download has released its files.
      await active;
      return { ...state };
    },
    install() {
      if (state.status !== "downloaded") throw new Error("No verified update is ready to install");
      if (installRequested) return;
      installRequested = true;
      try { quit(); } catch (error) { installRequested = false; throw error; }
    },
  };
}
