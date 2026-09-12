import { execFileSync } from "node:child_process";
import { createCipheriv, createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export const fixtureKey = () => Buffer.alloc(16, 7);
export function encrypt(value: string, host = ".example.test", version = 24) {
  const cipher = createCipheriv(
    "aes-128-cbc",
    fixtureKey(),
    Buffer.alloc(16, 32),
  );
  const input = Buffer.concat([
    version >= 24
      ? createHash("sha256").update(host).digest()
      : Buffer.alloc(0),
    Buffer.from(value),
  ]);
  return Buffer.concat([
    Buffer.from("v10"),
    cipher.update(input),
    cipher.final(),
  ]).toString("hex");
}
export async function cookieFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "amiba-cookie-test-"));
  const profile = path.join(
    home,
    "Library/Application Support/Google/Chrome/Default",
  );
  await mkdir(profile, { recursive: true });
  await writeFile(
    path.join(profile, "Preferences"),
    JSON.stringify({ profile: { name: "Synthetic profile" } }),
  );
  const database = path.join(profile, "Cookies");
  execFileSync("/usr/bin/sqlite3", [
    database,
    `
    CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (host_key TEXT, name TEXT, path TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER, is_persistent INTEGER, top_frame_site_key TEXT);
  `,
  ]);
  const add = (
    name: string,
    options: {
      domain?: string;
      value?: string;
      plaintext?: boolean;
      expires?: number;
      partition?: string;
      encrypted?: string;
      secure?: boolean;
    } = {},
  ) => {
    const domain = options.domain ?? ".example.test";
    const value = options.value ?? "synthetic-cookie-value";
    const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
    execFileSync("/usr/bin/sqlite3", [
      database,
      `INSERT INTO cookies VALUES (${quote(domain)}, ${quote(name)}, '/', ${quote(options.plaintext ? value : "")}, X'${options.plaintext ? "" : (options.encrypted ?? encrypt(value, domain))}', ${options.expires ? Math.round((options.expires + 11644473600) * 1e6) : 0}, ${options.secure === false ? 0 : 1}, 1, 1, ${options.expires ? 1 : 0}, ${quote(options.partition ?? "")})`,
    ]);
  };
  return { home, database, add };
}
