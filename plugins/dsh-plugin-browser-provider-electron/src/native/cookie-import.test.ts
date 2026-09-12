import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import {
  CookieImporter,
  decryptCookie,
  type ImportedCookie,
} from "./cookie-import.js";
import { cookieFixture, encrypt, fixtureKey } from "../test/cookie-fixture.js";
const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(key = vi.fn(async () => fixtureKey())) {
  const fixture = await cookieFixture();
  const writes: ImportedCookie[] = [];
  const store = {
    get: vi.fn(
      async (_filter: { name: string }) =>
        [] as Array<{ domain: string; path: string; name: string }>,
    ),
    set: vi.fn(async (cookie: ImportedCookie) => {
      writes.push(cookie);
    }),
    flushStore: vi.fn(async () => {}),
  };
  const importer = new CookieImporter(store, {
    home: fixture.home,
    platform: "darwin",
    key,
  });
  cleanups.push(
    () => importer.dispose(),
    () => rm(fixture.home, { recursive: true, force: true }),
  );
  const { sources } = await importer.sources();
  return { ...fixture, importer, store, writes, key, id: sources[0]!.id };
}
describe("local cookie import", () => {
  it("discovers metadata only and reads selected domains without modifying the source", async () => {
    const f = await setup();
    f.add("selected");
    f.add("other", { domain: ".other.test", value: "never-import" });
    const before = await readFile(f.database);
    expect(await f.importer.sites(f.id)).toEqual([
      { domain: "example.test", count: 1 },
      { domain: "other.test", count: 1 },
    ]);
    expect(f.key).not.toHaveBeenCalled();
    const result = await f.importer.run(f.id, ["example.test"], false);
    expect(result.imported).toBe(1);
    expect(f.writes[0]).toMatchObject({
      name: "selected",
      value: "synthetic-cookie-value",
      domain: ".example.test",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
    });
    expect(f.writes[0]).not.toHaveProperty("expirationDate");
    expect(await readFile(f.database)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("synthetic-cookie-value");
  });
  it("preserves existing cookies by default, and supports explicit replacement", async () => {
    const f = await setup();
    f.add("existing");
    f.store.get.mockResolvedValue([
      { name: "existing", domain: ".example.test", path: "/" },
    ]);
    expect(
      (await f.importer.run(f.id, ["example.test"], false)).preserved,
    ).toBe(1);
    expect(f.key).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
    expect((await f.importer.run(f.id, ["example.test"], true)).imported).toBe(
      1,
    );
  });
  it("preserves host-only cookies and rejects expired, partitioned and unsupported encrypted values", async () => {
    const f = await setup();
    f.add("host", { domain: "example.test" });
    f.add("old", { expires: 1000 });
    f.add("chips", { partition: "https://top.test" });
    f.add("new-format", { encrypted: "763230ffff" });
    const result = await f.importer.run(f.id, ["example.test"], false);
    expect(result).toMatchObject({ imported: 1, expired: 1, unsupported: 2 });
    expect(f.writes[0]).not.toHaveProperty("domain");
  });
  it("verifies v24 domain binding and supports older v10 values", () => {
    expect(
      decryptCookie(
        encrypt("old", ".example.test", 23),
        ".example.test",
        23,
        fixtureKey(),
      ),
    ).toBe("old");
    expect(() =>
      decryptCookie(encrypt("value"), ".wrong.test", 24, fixtureKey()),
    ).toThrow("INVALID_DOMAIN_HASH");
  });
  it("rejects unknown source IDs and SQL-shaped selections", async () => {
    const f = await setup();
    await expect(f.importer.sites("/etc/passwd")).rejects.toThrow(
      "INVALID_SOURCE",
    );
    await expect(f.importer.run(f.id, ["x' OR 1=1--"], true)).rejects.toThrow(
      "INVALID_SELECTION",
    );
    expect(f.key).not.toHaveBeenCalled();
  });
  it("does not write even plaintext rows when Keychain access is denied", async () => {
    const f = await setup(
      vi.fn(async () => {
        throw new Error("KEYCHAIN_DENIED");
      }),
    );
    f.add("plaintext", { plaintext: true });
    f.add("encrypted");
    await expect(f.importer.run(f.id, ["example.test"], false)).rejects.toThrow(
      "KEYCHAIN_DENIED",
    );
    expect(f.writes).toHaveLength(0);
  });
  it("revokes an import waiting for Keychain and wipes its returned key", async () => {
    let release!: (key: Buffer) => void;
    const key = vi.fn(
      () =>
        new Promise<Buffer>((resolve) => {
          release = resolve;
        }),
    );
    const f = await setup(key);
    f.add("pending");
    const operation = f.importer.run(f.id, ["example.test"], false);
    const rejected = expect(operation).rejects.toThrow("CANCELLED");
    await vi.waitFor(() => expect(key).toHaveBeenCalled());
    f.importer.dispose();
    const material = fixtureKey();
    release(material);
    await rejected;
    expect(f.writes).toHaveLength(0);
    expect(material.equals(Buffer.alloc(16))).toBe(true);
  });
  it("reports malformed encrypted values without exposing their contents", async () => {
    const f = await setup();
    f.add("broken", { encrypted: "763130ffff" });
    expect((await f.importer.run(f.id, ["example.test"], false)).failed).toBe(
      1,
    );
    expect(f.writes).toHaveLength(0);
  });
});

it("one-click import covers more than 100 websites with one key request", async () => {
  const f = await setup();
  for (let index = 0; index < 101; index++)
    f.add(`cookie${index}`, { domain: `site${index}.test` });
  const result = await f.importer.run(f.id, null, false);
  expect(result.imported).toBe(101);
  expect(f.key).toHaveBeenCalledTimes(1);
  expect(f.writes.some((cookie) => cookie.url.includes("site100.test"))).toBe(
    true,
  );
});
