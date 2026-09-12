import { execFile } from "node:child_process";
import {
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomUUID,
} from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  CookieImportResult,
  CookieSite,
  CookieSource,
} from "../shared/cookie-import.js";

// Chromium's macOS OSCrypt v10 format and cookie schema v24. No source writes,
// profile copying, shell interpolation, or plaintext credential temporary files.
const BROWSERS = [
  {
    name: "Chrome",
    directory: "Google/Chrome",
    service: "Chrome Safe Storage",
  },
  {
    name: "Edge",
    directory: "Microsoft Edge",
    service: "Microsoft Edge Safe Storage",
  },
  {
    name: "Brave",
    directory: "BraveSoftware/Brave-Browser",
    service: "Brave Safe Storage",
  },
];
interface Source extends CookieSource {
  database: string;
  root: string;
  service: string;
}
interface CookieRow {
  host_key: string;
  name: string;
  path: string;
  value: string;
  encrypted: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  is_persistent: number;
  partition_key: string;
}
export interface ImportedCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}
interface CookieStore {
  get(filter: {
    name: string;
  }): Promise<Array<{ name: string; domain?: string; path?: string }>>;
  set(cookie: ImportedCookie): Promise<void>;
  flushStore(): Promise<void>;
}
export class CookieImportError extends Error {
  constructor(code: string) {
    super(code);
  }
}
function command(
  file: string,
  args: string[],
  signal: AbortSignal,
  timeout = 15_000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout, signal },
      (error, stdout) =>
        error
          ? reject(new CookieImportError("SOURCE_UNAVAILABLE"))
          : resolve(stdout),
    );
  });
}
async function keychain(service: string, signal: AbortSignal): Promise<Buffer> {
  let password: Buffer;
  try {
    password = await command(
      "/usr/bin/security",
      ["find-generic-password", "-w", "-s", service],
      signal,
      120_000,
    );
  } catch {
    throw new CookieImportError("KEYCHAIN_DENIED");
  }
  try {
    // security adds a trailing newline; the stored password itself is base64.
    const end = password.length - (password.at(-1) === 10 ? 1 : 0);
    if (end <= 0) throw new CookieImportError("KEYCHAIN_DENIED");
    return pbkdf2Sync(password.subarray(0, end), "saltysalt", 1003, 16, "sha1");
  } finally {
    password.fill(0);
  }
}
export function decryptCookie(
  encrypted: string,
  host: string,
  version: number,
  key: Buffer,
): string {
  const bytes = Buffer.from(encrypted, "hex");
  if (bytes.subarray(0, 3).toString() !== "v10")
    throw new CookieImportError("UNSUPPORTED_FORMAT");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 32));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(3)),
    decipher.final(),
  ]);
  try {
    if (version >= 24) {
      if (
        !plaintext
          .subarray(0, 32)
          .equals(createHash("sha256").update(host).digest())
      )
        throw new CookieImportError("INVALID_DOMAIN_HASH");
      return plaintext.subarray(32).toString("utf8");
    }
    return plaintext.toString("utf8");
  } finally {
    plaintext.fill(0);
  }
}
const domainOf = (host: string) => host.replace(/^\./, "");
const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
const SAME_SITE: Record<number, ImportedCookie["sameSite"]> = {
  [-1]: "unspecified",
  0: "no_restriction",
  1: "lax",
  2: "strict",
};

export class CookieImporter {
  private readonly sourcesById = new Map<string, Source>();
  private readonly abort = new AbortController();
  private busy = false;
  constructor(
    private readonly store: CookieStore,
    private readonly options: {
      home?: string;
      platform?: string;
      key?: (service: string, signal: AbortSignal) => Promise<Buffer>;
    } = {},
  ) {}
  dispose() {
    this.abort.abort();
    this.sourcesById.clear();
  }
  private active() {
    if (this.abort.signal.aborted) throw new CookieImportError("CANCELLED");
  }
  async sources(): Promise<{ supported: boolean; sources: CookieSource[] }> {
    this.active();
    if ((this.options.platform ?? process.platform) !== "darwin")
      return { supported: false, sources: [] };
    const sources: CookieSource[] = [];
    for (const browser of BROWSERS) {
      const root = path.join(
        this.options.home ?? homedir(),
        "Library/Application Support",
        browser.directory,
      );
      const entries = await readdir(root, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^(Default|Profile \d+)$/.test(entry.name))
          continue;
        const profileRoot = path.join(root, entry.name);
        for (const relative of ["Network/Cookies", "Cookies"]) {
          const database = path.join(profileRoot, relative);
          if (!(await stat(database).catch(() => null))?.isFile()) continue;
          let profile = entry.name;
          try {
            const preferences = JSON.parse(
              await readFile(path.join(profileRoot, "Preferences"), "utf8"),
            );
            if (typeof preferences.profile?.name === "string")
              profile = preferences.profile.name.slice(0, 100);
          } catch {
            /* A profile without Preferences is still usable. */
          }
          const known = [...this.sourcesById.values()].find(
            (source) => source.database === database,
          );
          const id = known?.id ?? randomUUID();
          this.sourcesById.set(id, {
            id,
            browser: browser.name,
            profile,
            database,
            root,
            service: browser.service,
          });
          sources.push({ id, browser: browser.name, profile });
          break;
        }
      }
    }
    this.active();
    return { supported: true, sources };
  }
  private async source(id: string): Promise<Source> {
    this.active();
    const source = this.sourcesById.get(id);
    if (!source) throw new CookieImportError("INVALID_SOURCE");
    // Renderer supplies opaque IDs only, never arbitrary paths or SQL.
    const [root, database] = await Promise.all([
      realpath(source.root),
      realpath(source.database),
    ]).catch(() => {
      throw new CookieImportError("SOURCE_UNAVAILABLE");
    });
    if (!database.startsWith(`${root}${path.sep}`))
      throw new CookieImportError("INVALID_SOURCE");
    return { ...source, database };
  }
  private async query<T>(source: Source, sql: string): Promise<T[]> {
    this.active();
    const output = await command(
      "/usr/bin/sqlite3",
      ["-readonly", "-json", "-cmd", ".timeout 3000", source.database, sql],
      this.abort.signal,
    );
    try {
      this.active();
      return JSON.parse(output.toString("utf8") || "[]");
    } catch {
      throw new CookieImportError("SOURCE_UNAVAILABLE");
    } finally {
      output.fill(0);
    }
  }
  async sites(id: string): Promise<CookieSite[]> {
    const source = await this.source(id);
    // Metadata only. Cookie values and encryption material never reach the UI.
    return this.query<CookieSite>(
      source,
      "SELECT ltrim(host_key, '.') AS domain, count(*) AS count FROM cookies GROUP BY ltrim(host_key, '.') ORDER BY domain",
    );
  }
  async run(
    id: string,
    domains: string[] | null,
    overwrite: boolean,
  ): Promise<CookieImportResult> {
    this.active();
    if (this.busy) throw new CookieImportError("BUSY");
    if (
      domains !== null &&
      (!Array.isArray(domains) ||
        !domains.length ||
        domains.length > 100 ||
        domains.some(
          (domain) =>
            typeof domain !== "string" ||
            domain.length > 253 ||
            !/^[a-z0-9][a-z0-9.-]*$/i.test(domain),
        ))
    )
      throw new CookieImportError("INVALID_SELECTION");
    this.busy = true;
    let key: Buffer | undefined;
    let rows: CookieRow[] = [];
    try {
      const source = await this.source(id);
      const columns = await this.query<{ name: string }>(
        source,
        "PRAGMA table_info(cookies)",
      );
      const partition = columns.some(
        (column) => column.name === "top_frame_site_key",
      )
        ? "top_frame_site_key"
        : "''";
      const selected = [...new Set(domains ?? [])]
        .flatMap((domain) => [domain, `.${domain}`])
        .map(sqlString)
        .join(",");
      // Version and rows share one SQLite read transaction, including committed WAL data.
      const limit = domains === null ? 100_000 : 10_000;
      const filter = domains === null ? "" : `WHERE host_key IN (${selected})`;
      const data = await this.query<CookieRow & { version: number }>(
        source,
        `SELECT host_key, name, path, value, hex(encrypted_value) AS encrypted, expires_utc, is_secure, is_httponly, samesite, is_persistent, ${partition} AS partition_key, (SELECT CAST(value AS INTEGER) FROM meta WHERE key='version') AS version FROM cookies ${filter} LIMIT ${limit + 1}`,
      );
      rows = data;
      if (rows.length > limit) throw new CookieImportError("TOO_MANY_COOKIES");
      if (
        data.some(
          (row) =>
            !Number.isInteger(row.version) ||
            row.version < 10 ||
            row.version > 24,
        )
      )
        throw new CookieImportError("UNSUPPORTED_FORMAT");
      const result: CookieImportResult = {
        imported: 0,
        preserved: 0,
        expired: 0,
        unsupported: 0,
        failed: 0,
      };
      const candidates: typeof data = [];
      for (const row of data) {
        this.active();
        if (
          row.partition_key ||
          (row.encrypted && !row.encrypted.toLowerCase().startsWith("763130"))
        ) {
          result.unsupported++;
          continue;
        }
        const expirationDate = row.is_persistent
          ? row.expires_utc / 1_000_000 - 11644473600
          : undefined;
        if (
          expirationDate !== undefined &&
          expirationDate <= Date.now() / 1000
        ) {
          result.expired++;
          continue;
        }
        const existing = overwrite
          ? []
          : await this.store.get({ name: row.name });
        this.active();
        if (
          existing.some(
            (cookie) =>
              cookie.domain === row.host_key && cookie.path === row.path,
          )
        ) {
          result.preserved++;
          continue;
        }
        candidates.push(row);
      }
      // Obtain permission before any writes, so cancelling Keychain cannot
      // leave an unreported partial import of plaintext source rows.
      if (candidates.some((row) => row.encrypted)) {
        key = await (this.options.key ?? keychain)(
          source.service,
          this.abort.signal,
        );
        this.active();
      }
      for (const row of candidates) {
        this.active();
        // A user may have signed in while the system permission dialog was
        // open. Recheck conflicts immediately before setting each cookie.
        if (!overwrite) {
          const existing = await this.store.get({ name: row.name });
          this.active();
          if (
            existing.some(
              (cookie) =>
                cookie.domain === row.host_key && cookie.path === row.path,
            )
          ) {
            result.preserved++;
            continue;
          }
        }
        const expirationDate = row.is_persistent
          ? row.expires_utc / 1_000_000 - 11644473600
          : undefined;
        let value = "";
        try {
          value = row.encrypted
            ? decryptCookie(row.encrypted, row.host_key, row.version, key!)
            : row.value;
          const hostname = domainOf(row.host_key);
          const url = new URL(
            `${row.is_secure ? "https" : "http"}://${hostname}`,
          );
          if (url.hostname !== hostname || !row.path.startsWith("/"))
            throw new Error("Invalid source cookie");
          url.pathname = row.path;
          this.active();
          await this.store.set({
            url: url.href,
            name: row.name,
            value,
            path: row.path,
            ...(row.host_key.startsWith(".") ? { domain: row.host_key } : {}),
            secure: Boolean(row.is_secure),
            httpOnly: Boolean(row.is_httponly),
            ...(expirationDate !== undefined ? { expirationDate } : {}),
            sameSite: SAME_SITE[row.samesite] ?? "unspecified",
          });
          result.imported++;
        } catch {
          this.active();
          result.failed++;
        } finally {
          value = "";
          row.value = "";
          row.encrypted = "";
        }
      }
      this.active();
      await this.store.flushStore();
      return result;
    } finally {
      key?.fill(0);
      for (const row of rows) {
        row.value = "";
        row.encrypted = "";
      }
      this.busy = false;
    }
  }
}
