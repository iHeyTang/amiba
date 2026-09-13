import { mkdtemp, readFile, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { configSchema, WeixinApi } from "./api.js";
import {
  crypt,
  decodeKey,
  downloadMedia,
  uploadMedia,
  MAX_MEDIA_BYTES,
  pruneMedia,
} from "./media.js";
const signal = new AbortController().signal;
const roots: string[] = [];
async function root() {
  const r = await mkdtemp(path.join(tmpdir(), "weixin-media-"));
  roots.push(r);
  return r;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("decrypts both supported key encodings", () => {
  const key = Buffer.alloc(16, 7);
  const bytes = Buffer.from("personal document");
  expect(crypt(crypt(bytes, key), key, true)).toEqual(bytes);
  expect(decodeKey(key.toString("base64"))).toEqual(key);
  expect(
    decodeKey(Buffer.from(key.toString("hex")).toString("base64")),
  ).toEqual(key);
  expect(() => decodeKey("bad")).toThrow();
});
it("downloads encrypted attachments to a confined private path", async () => {
  const directory = await root();
  const key = Buffer.alloc(16, 9);
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response(new Uint8Array(crypt(Buffer.from("content"), key))),
  );
  const file = await downloadMedia(
    new WeixinApi(fetcher),
    {
      type: 4,
      file_item: {
        file_name: "../../x.txt",
        media: { aes_key: key.toString("base64"), encrypt_query_param: "a/b" },
      },
    },
    directory,
    "id",
    signal,
  );
  expect(path.dirname(file!)).toBe(directory);
  expect(await readFile(file!, "utf8")).toBe("content");
  expect(fetcher.mock.calls[0][0]).toContain("encrypted_query_param=a%2Fb");
});
it("does not fetch media from arbitrary URLs or accept oversized bodies", async () => {
  const directory = await root();
  const fetcher = vi.fn(
    async (_url: RequestInfo | URL, _init?: RequestInit) =>
      new Response("x", {
        headers: { "content-length": String(MAX_MEDIA_BYTES + 100) },
      }),
  );
  const api = new WeixinApi(fetcher);
  await expect(
    downloadMedia(
      api,
      {
        type: 2,
        image_item: { media: { full_url: "https://evil.test/file" } },
      },
      directory,
      "id",
      signal,
    ),
  ).rejects.toThrow("untrusted_url");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    downloadMedia(
      api,
      { type: 2, image_item: { media: { encrypt_query_param: "x" } } },
      directory,
      "id",
      signal,
    ),
  ).rejects.toThrow("too_large");
});
it.each([
  ["report.pdf", 4],
  ["photo.png", 2],
  ["movie.mp4", 5],
  ["voice.mp3", 4],
])("uploads %s with the actual supported message type", async (name, type) => {
  const directory = await root();
  const file = path.join(directory, name);
  await writeFile(file, "example");
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const api = new WeixinApi(async (url, init) => {
    requests.push({ url: String(url), init });
    return String(url).includes("getuploadurl")
      ? Response.json({ upload_param: "upload" })
      : new Response("", { headers: { "x-encrypted-param": "download" } });
  });
  const item = await uploadMedia(
    api,
    configSchema.parse({ botToken: "secret", botId: "bot", userId: "owner" }),
    file,
    signal,
  );
  expect(item).toMatchObject({ type });
  const request = JSON.parse(requests[0].init!.body as string);
  expect(request.rawsize).toBe(7);
  expect(request.filesize).toBe(16);
  expect(
    crypt(
      Buffer.from(requests[1].init!.body as Uint8Array),
      Buffer.from(request.aeskey, "hex"),
      true,
    ).toString(),
  ).toBe("example");
  expect(requests[1].init?.headers).not.toHaveProperty("Authorization");
});

it("prunes old and excess downloaded files without touching outbound source files", async () => {
  const directory = await root();
  const old = path.join(directory, "old");
  const current = path.join(directory, "current");
  await writeFile(old, "12345");
  await writeFile(current, "12345");
  await utimes(old, new Date(0), new Date(0));
  await pruneMedia(directory, 5);
  await expect(readFile(old)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(current, "utf8")).toBe("12345");
});
