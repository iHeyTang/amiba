import type { UpdateState } from "./controller";

/** One downloadable installer advertised by the release feed. */
export type ManualReleaseAsset = {
  name: string;
  url: string;
  /** Lowercase hex sha256 published by the release host; empty when absent. */
  sha256: string;
  size: number;
};

export type ManualRelease = { version: string; assets: ManualReleaseAsset[] };

/**
 * Compare two dotted numeric versions.
 *
 * Anything that is not a run of numeric parts — a prerelease tag, a malformed
 * tag — is never treated as newer. Offering an update we cannot order would be
 * worse than offering none, and the manual path has no signature to fall back
 * on if we pick the wrong file.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (value: string) => {
    const split = value.trim().replace(/^v/, "").split(".");
    return split.length > 0 && split.every((part) => /^\d+$/.test(part))
      ? split.map(Number)
      : null;
  };
  const next = parts(candidate);
  const base = parts(current);
  if (!next || !base) return false;
  for (let index = 0; index < Math.max(next.length, base.length); index += 1) {
    const left = next[index] ?? 0;
    const right = base[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

/**
 * Update path for builds the platform will not let us replace in place.
 *
 * macOS verifies the signature of whatever replaces a running bundle, so an
 * ad-hoc signed build cannot install its own update. Detection and downloading
 * do not need that signature though, so we keep them and stop exactly where the
 * platform does: the user mounts the installer and drags the app over.
 *
 * Kept free of Electron, the network and the filesystem so the state machine
 * and its failure modes are testable on their own.
 */
export function createManualUpdateController({ currentVersion, assetName, fetchRelease, download, install, notify }: {
  currentVersion: string;
  /** Installer this platform would run, given the released version. */
  assetName: (version: string) => string;
  fetchRelease: () => Promise<ManualRelease>;
  /** Downloads and verifies the asset, or rejects without leaving a partial file. */
  download: (asset: ManualReleaseAsset, onProgress: (percent: number) => void) => Promise<{ filePath: string }>;
  /** Hands the verified installer to the OS, then lets the host quit. */
  install: (filePath: string) => void;
  notify: (state: UpdateState) => void;
}) {
  let state: UpdateState = { status: "idle", currentVersion };
  let active: Promise<UpdateState> | undefined;
  let selected: ManualReleaseAsset | undefined;
  let installerPath: string | undefined;

  const emit = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    notify({ ...state });
  };
  const fail = (error: unknown) => {
    selected = undefined;
    emit({ status: "error", error: error instanceof Error ? error.message : String(error) });
    return { ...state };
  };

  async function detect() {
    emit({ status: "checking", error: undefined, percent: undefined });
    const release = await fetchRelease();
    const version = release.version.trim().replace(/^v/, "");
    if (!isNewerVersion(version, currentVersion)) {
      selected = undefined;
      emit({ status: "idle", version: undefined, percent: undefined });
      return;
    }
    // A verified installer from an earlier run is still valid for this version,
    // so a re-check must not throw it away or download it twice.
    if (installerPath && state.version === version && state.status === "ready") {
      emit({ status: "ready", percent: 100, error: undefined });
      return;
    }
    const asset = release.assets.find((entry) => entry.name === assetName(version));
    if (!asset) throw new Error(`Release ${version} has no installer for this platform`);
    // The digest is the only integrity signal an unsigned build has: HTTPS plus
    // a hash published by the release host. Without it there is nothing to pin.
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error(`Release asset ${asset.name} has no sha256 digest`);
    selected = asset;
    emit({ status: "offered", version, percent: undefined, error: undefined });
  }

  async function fetchUpdate() {
    if (state.status !== "offered" || !selected) throw new Error("No update is ready to download");
    const asset = selected;
    const version = state.version;
    emit({ status: "downloading", percent: 0 });
    const result = await download(asset, (percent) => {
      if (state.status === "downloading") emit({ percent });
    });
    installerPath = result.filePath;
    emit({ status: "ready", version, percent: 100, error: undefined });
  }

  return {
    getState: () => ({ ...state }),
    check(): Promise<UpdateState> {
      if (active) return active;
      // A finished download stays put: the user has an installer waiting, and
      // replacing it here would restart a large download they did not ask for.
      if (state.status === "ready" || state.status === "downloading") return Promise.resolve({ ...state });
      active = detect().then(() => ({ ...state })).catch(fail).finally(() => { active = undefined; });
      return active;
    },
    download(): Promise<UpdateState> {
      if (active) return active;
      active = fetchUpdate().then(() => ({ ...state })).catch(fail).finally(() => { active = undefined; });
      return active;
    },
    install() {
      if (state.status !== "ready" || !installerPath) throw new Error("No verified installer is ready to open");
      install(installerPath);
    },
  };
}
