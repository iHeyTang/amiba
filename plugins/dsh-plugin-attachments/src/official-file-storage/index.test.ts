import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Context, Service } from "@deepseek-ai/cordis";
import { createOfficialFileStorage, installOfficialFileStorage } from "./index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "amiba-official-files-")); roots.push(root);
  return { root, store: createOfficialFileStorage(join(root, "objects", "v1")) };
}
async function collect(stream: AsyncIterable<Uint8Array>) {
  const chunks = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks);
}

it("persists exact binary bytes and sanitized names across fresh storage instances", async () => {
  const { root, store } = await fixture();
  const bytes = Buffer.from([0, 255, 12, 42, 128]);
  const ref = await store.saveFile({ data: bytes, name: "C:\\private\\CON.txt" });
  expect(ref).toMatchObject({ name: "_CON.txt", bytes: 5 });
  expect(ref.attachmentId).toMatch(/^sha256:[a-f0-9]{64}$/);
  const reopened = createOfficialFileStorage(join(root, "objects", "v1"));
  expect(await collect(reopened.readFileStream(ref))).toEqual(bytes);
  expect(await readFile(reopened.fileHostPath(ref))).toEqual(bytes);
  await expect(collect(store.readFileStream({ ...ref, name: "../outside" }))).rejects.toMatchObject({ code: "INVALID_ATTACHMENT_REF" });
});

it("streams and deduplicates concurrent writes without changing file content or display names", async () => {
  const { store } = await fixture();
  const chunks = [Buffer.alloc(65536, 7), Buffer.from("tail")];
  const [first, second] = await Promise.all([
    store.saveFileStream({ data: (async function* () { for (const chunk of chunks) yield chunk; })(), name: "first.bin" }),
    store.saveFile({ data: Buffer.concat(chunks), name: "second.bin" }),
  ]);
  expect(first.attachmentId).toBe(second.attachmentId);
  expect(first.name).not.toBe(second.name);
  expect(await collect(store.readFileStream(first))).toEqual(Buffer.concat(chunks));
  expect((await stat(store.fileHostPath(first))).ino).toBe((await stat(store.fileHostPath(second))).ino);
});

it("accepts canonical empty files and rejects malformed encoding before persistence", async () => {
  const { store } = await fixture();
  const empty = await store.admitEncodedFile({ data: "", name: "empty.txt" });
  expect(empty.bytes).toBe(0);
  expect(await collect(store.readFileStream(empty))).toEqual(Buffer.alloc(0));
  for (const data of ["a", "AB==", "AQID\n", "####"]) {
    await expect(store.admitEncodedFile({ data })).rejects.toMatchObject({ code: "INVALID_FILE_BASE64" });
  }
});

it("cleans cancelled staging and detects corrupted content on subsequent reads", async () => {
  const { root, store } = await fixture();
  const abort = new AbortController();
  await expect(store.saveFileStream({ signal: abort.signal, data: (async function* () {
    yield Buffer.from("first"); abort.abort(); yield Buffer.from("second");
  })() })).rejects.toMatchObject({ name: "AbortError" });
  expect(await readdir(join(root, "objects", "v1", "tmp"))).toEqual([]);
  const ref = await store.saveFile({ data: Buffer.from("abc") });
  await chmod(store.fileHostPath(ref), 0o600);
  await writeFile(store.fileHostPath(ref), "xyz");
  await expect(collect(store.readFileStream(ref))).rejects.toMatchObject({ code: "ATTACHMENT_CORRUPT" });
});

it("adds and removes only its own capabilities while preserving the original backend", async () => {
  const { root } = await fixture();
  const original = vi.fn();
  const service = { saveImage: original } as { saveImage: typeof original; saveFile?: unknown; readFileStream?: unknown };
  const off = installOfficialFileStorage(service, join(root, "files", "v1"));
  expect(service.saveFile).toBeTypeOf("function");
  expect(service.saveImage).toBe(original);
  const replacement = vi.fn(); service.saveFile = replacement;
  off(); off();
  expect(service.saveImage).toBe(original);
  expect(service.saveFile).toBe(replacement);
  expect(service.readFileStream).toBeUndefined();
  const modern = { saveFile: original };
  installOfficialFileStorage(modern, root)();
  expect(Object.keys(modern)).toEqual(["saveFile"]);
  expect(modern.saveFile).toBe(original);
});

it("removes capabilities through a service scope that binds methods on each read", async () => {
  const { root } = await fixture();
  class Backend extends Service { constructor(ctx: Context) { super(ctx, "fileStorageFixture"); } }
  const ctx = new Context();
  const service = new Backend(ctx);
  const before = Object.getOwnPropertyNames(service);
  const scope = ctx.get("fileStorageFixture") as object;
  const off = installOfficialFileStorage(scope, root);
  expect("saveFile" in service).toBe(true);
  off();
  expect(Object.getOwnPropertyNames(service)).toEqual(before);
});
