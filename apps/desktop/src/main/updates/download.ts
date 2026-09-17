import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import type { Readable } from "node:stream";

export type InstallerStream = { stream: Readable; length: number };

/** Only HTTPS, and only without embedded credentials. */
export function assertSecureUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Installer downloads must use HTTPS without credentials");
  }
  return url;
}

/** Resolve a redirect target, refusing to leave HTTPS along the way. */
export function nextHopUrl(location: string, base: string): string {
  return assertSecureUrl(new URL(location, base).href).href;
}

/** Stream a URL, following redirects (GitHub release assets redirect to a CDN). */
export async function openSecureStream(url: string, redirects = 5): Promise<InstallerStream> {
  const target = assertSecureUrl(url);
  return new Promise((resolve, reject) => {
    const request = https.get(target, {
      headers: { Accept: "application/octet-stream", "User-Agent": "Amiba-Desktop" },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects <= 0) {
          reject(new Error("Installer download redirected too many times"));
          return;
        }
        openSecureStream(nextHopUrl(location, target.href), redirects - 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Installer download failed (HTTP ${status})`));
        return;
      }
      resolve({ stream: response, length: Number(response.headers["content-length"]) || 0 });
    });
    // A stalled connection would otherwise leave the UI in "downloading" forever.
    request.setTimeout(30_000, () => request.destroy(new Error("Installer download timed out")));
    request.on("error", reject);
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", resolve);
  });
  return hash.digest("hex");
}

async function ensureSpace(directory: string, size: number): Promise<void> {
  if (!size) return;
  const statfs = (fs as unknown as { statfs?: (path: string) => Promise<{ bavail: number; bsize: number }> }).statfs;
  if (typeof statfs !== "function") return;
  let available: number;
  try {
    const stats = await statfs(directory);
    available = stats.bavail * stats.bsize;
  } catch {
    return; // A filesystem that cannot report free space must not block the update.
  }
  if (available < size) throw new Error("Not enough free disk space for the update");
}

function pump(stream: Readable, destination: string, size: number, length: number, onProgress: (percent: number) => void): Promise<void> {
  const total = length > 0 ? length : size;
  return new Promise<void>((resolve, reject) => {
    const file = createWriteStream(destination);
    let received = 0;
    let lastPercent = -1;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      file.destroy();
      stream.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    stream.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (size > 0 && received > size) {
        fail(new Error("Installer download exceeded the published size"));
        return;
      }
      if (total <= 0) return;
      const percent = Math.min(99, Math.floor((received / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress(percent);
      }
    });
    stream.on("error", fail);
    file.on("error", fail);
    file.on("finish", () => {
      if (settled) return;
      if (size > 0 && received !== size) {
        fail(new Error(`Installer download is incomplete (${received} of ${size} bytes)`));
        return;
      }
      settled = true;
      resolve();
    });
    stream.pipe(file);
  });
}

/** Drop installers the new download supersedes. Opportunistic: never fails an update. */
export async function pruneInstallers(directory: string, keep: string): Promise<void> {
  try {
    const entries = await fs.readdir(directory);
    await Promise.all(entries
      // `.part` covers a download the process did not live to clean up.
      .filter((name) => name !== keep && (name.endsWith(".dmg") || name.endsWith(".part")))
      .map((name) => fs.rm(path.join(directory, name), { force: true })));
  } catch {
    // A stale installer on disk is harmless; a failed update is not.
  }
}

/**
 * Download an installer to `filePath` and prove it matches the published digest.
 *
 * An unsigned build has no signature to check, so this digest is the whole
 * security story: HTTPS to the release host, plus the hash that host publishes.
 * Nothing is handed to the user until it matches, and a partial download never
 * survives a failure.
 */
export async function downloadVerified(
  request: { url: string; sha256: string; size: number; filePath: string },
  options: { onProgress: (percent: number) => void; open?: (url: string) => Promise<InstallerStream> },
): Promise<{ filePath: string }> {
  const expected = request.sha256.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Refusing to download an installer without a published digest");
  if (!path.isAbsolute(request.filePath)) throw new Error("Installer path must be absolute");
  assertSecureUrl(request.url);
  await fs.mkdir(path.dirname(request.filePath), { recursive: true });
  // A verified file from an interrupted session is reused instead of refetched.
  if (existsSync(request.filePath) && await hashFile(request.filePath) === expected) {
    options.onProgress(100);
    return { filePath: request.filePath };
  }
  await ensureSpace(path.dirname(request.filePath), request.size);
  const partial = `${request.filePath}.part`;
  await fs.rm(partial, { force: true });
  try {
    const open = options.open ?? openSecureStream;
    const { stream, length } = await open(request.url);
    await pump(stream, partial, request.size, length, options.onProgress);
    if (await hashFile(partial) !== expected) throw new Error("Downloaded installer failed integrity verification");
    await fs.rm(request.filePath, { force: true });
    await fs.rename(partial, request.filePath);
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
  options.onProgress(100);
  return { filePath: request.filePath };
}
