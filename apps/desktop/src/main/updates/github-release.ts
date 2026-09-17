import type { ManualRelease } from "./manual";

// Both halves must start with an alphanumeric character: the repository name is
// interpolated into an API URL, and a value like `../etc` would otherwise
// rewrite the path instead of being rejected.
const REPOSITORY = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*$/;
const DIGEST = /^sha256:([a-f0-9]{64})$/;
const API_VERSION = "2022-11-28";

/**
 * Read the `releases/latest` payload into the shape the manual updater needs.
 *
 * Assets without a published sha256 digest are dropped rather than surfaced:
 * every check downstream treats that digest as the only integrity signal, so an
 * asset we cannot pin must not look downloadable.
 */
export function parseLatestRelease(payload: unknown): ManualRelease {
  if (!payload || typeof payload !== "object") throw new Error("Release metadata is not an object");
  const record = payload as Record<string, unknown>;
  const tag = typeof record.tag_name === "string" ? record.tag_name.trim() : "";
  if (!/^v?\d+(?:\.\d+)*$/.test(tag)) throw new Error("Release metadata has no usable version tag");
  const assets = Array.isArray(record.assets) ? record.assets : [];
  return {
    version: tag.replace(/^v/, ""),
    assets: assets.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const asset = entry as Record<string, unknown>;
      const name = typeof asset.name === "string" && /^[A-Za-z0-9._-]+$/.test(asset.name) ? asset.name : "";
      const digest = typeof asset.digest === "string" ? DIGEST.exec(asset.digest.toLowerCase())?.[1] ?? "" : "";
      const size = typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size > 0 ? asset.size : 0;
      if (!name || !size) return [];
      let url: URL;
      try {
        url = new URL(typeof asset.browser_download_url === "string" ? asset.browser_download_url : "");
      } catch {
        return [];
      }
      if (url.protocol !== "https:" || url.username || url.password) return [];
      return [{ name, url: url.href, sha256: digest, size }];
    }),
  };
}

/**
 * Latest non-prerelease release, over the public GitHub API.
 *
 * Deliberately not electron-updater: that path exists to *install* an update,
 * and macOS refuses to let an ad-hoc signed bundle replace itself. Checking and
 * downloading need no signature, so they use the plain release feed instead.
 */
export async function fetchLatestRelease(repository: string, request: typeof fetch = fetch): Promise<ManualRelease> {
  if (!REPOSITORY.test(repository)) throw new Error("Invalid update repository");
  const response = await request(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Amiba-Desktop",
      "X-GitHub-Api-Version": API_VERSION,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Update check failed (HTTP ${response.status})`);
  return parseLatestRelease(await response.json());
}
