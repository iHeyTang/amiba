import { lookup } from "node:dns/promises";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import type { MediaArtifactSource, MediaKind } from "./contracts.js";
import type { MediaStore } from "./store.js";
const MAX_BYTES = 256 * 1024 * 1024;
export function publicAddress(address: string): boolean {
  if (isIP(address) === 6)
    return /^2[0-9a-f]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
  const parts = address.split(".").map(Number);
  const [a, b] = parts;
  return (
    parts.length === 4 &&
    a !== 0 &&
    a !== 10 &&
    a !== 127 &&
    a! < 224 &&
    !(a === 169 && b === 254) &&
    !(a === 172 && b! >= 16 && b! <= 31) &&
    !(a === 192 && b === 168) &&
    !(a === 100 && b! >= 64 && b! <= 127) &&
    !(a === 198 && (b === 18 || b === 19))
  );
}
/** A fake-IP DNS proxy is not evidence that the original storage host is private.
 * Resolve only that special case over authenticated HTTPS, then retain the same
 * public-IP check and socket pinning. Never send signed URL paths or credentials.
 */
export async function artifactAddresses(
  host: string,
  signal: AbortSignal,
  dns = lookup,
  http: typeof fetch = fetch,
) {
  let addresses = await dns(host, { all: true });
  if (
    !isIP(host) &&
    addresses.length &&
    addresses.every((row) => /^198\.(18|19)\./.test(row.address))
  ) {
    const response = await http(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`,
      {
        headers: { Accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      },
    );
    if (!response.ok)
      throw new Error("Could not resolve storage host through DNS-over-HTTPS");
    const body = (await response.json()) as {
      Status?: number;
      Answer?: Array<{ type: number; data: string }>;
    };
    if (body.Status !== 0)
      throw new Error("Storage host DNS resolution failed");
    addresses = (body.Answer ?? [])
      .filter((row) => row.type === 1)
      .map((row) => ({ address: row.data, family: 4 }));
  }
  if (
    !addresses.length ||
    addresses.some((row) => !isIP(row.address) || !publicAddress(row.address))
  )
    throw new Error("Artifact URL resolves to a non-public address");
  return addresses;
}
/** Node autoSelectFamily requests all addresses; its callback shape differs from a single lookup. */
export function pinnedLookup(pinned: { address: string; family: number }): LookupFunction {
  return (_host, options, callback) => {
    if (options.all) callback(null, [pinned]);
    else callback(null, pinned.address, pinned.family);
  };
}
/** Resolve once and pin DNS in the socket lookup; never send provider credentials to artifact hosts. */
export async function downloadArtifact(
  input: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<Buffer> {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Artifact URL must be public HTTPS");
  const addresses = await artifactAddresses(
    url.hostname.replace(/^\[|\]$/g, ""),
    signal,
  );
  const pinned = addresses[0]!;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        signal,
        lookup: pinnedLookup(pinned),
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
          response.resume();
          if (redirects >= 3 || !response.headers.location) {
            reject(new Error("Invalid artifact redirect"));
            return;
          }
          downloadArtifact(
            new URL(response.headers.location, url).href,
            signal,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Artifact download HTTP ${response.statusCode}`));
          return;
        }
        if (Number(response.headers["content-length"]) > MAX_BYTES) {
          response.destroy();
          reject(new Error("Artifact exceeds 256 MiB"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES)
            response.destroy(new Error("Artifact exceeds 256 MiB"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on("error", reject);
    req.end();
  });
}
export function detectMedia(bytes: Uint8Array, kind: MediaKind): string {
  const b = Buffer.from(bytes);
  const ascii = (start: number, end: number) => b.toString("ascii", start, end);
  if (kind === "file") {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return "application/json";
  }
  if (kind === "image") {
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      return "image/png";
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")
      return "image/gif";
  }
  if (kind === "video") {
    if (ascii(4, 8) === "ftyp")
      return ascii(8, 12) === "qt  " ? "video/quicktime" : "video/mp4";
    if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))
      return "video/webm";
  }
  if (kind === "audio") {
    if (ascii(0, 3) === "ID3" || (b[0] === 255 && (b[1]! & 0xe0) === 0xe0))
      return "audio/mpeg";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
    if (ascii(0, 4) === "fLaC") return "audio/flac";
    if (ascii(0, 4) === "OggS") return "audio/ogg";
  }
  throw new Error("Generated content is not a supported media file");
}
export async function persistArtifact(
  store: MediaStore,
  sessionId: string,
  source: MediaArtifactSource,
  signal: AbortSignal,
) {
  if (!!source.bytes === !!source.url)
    throw new Error("Artifact must have exactly one byte source");
  const bytes =
    source.bytes ??
    (await downloadArtifact(
      source.url!,
      AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    ));
  if (!bytes.length || bytes.length > MAX_BYTES)
    throw new Error("Generated file is empty or exceeds 256 MiB");
  return store.saveArtifact(
    sessionId,
    source.kind,
    detectMedia(bytes, source.kind),
    bytes,
  );
}
