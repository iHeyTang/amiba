import { voiceToWav } from "./voice.js";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  open,
  mkdir,
  writeFile,
  readdir,
  lstat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import {
  CDN_BASE,
  type Item,
  type WeixinConfig,
  WeixinApi,
  weixinUrl,
} from "./api.js";

export const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
export function decodeKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 16) return decoded;
  if (/^[a-f0-9]{32}$/i.test(decoded.toString()))
    return Buffer.from(decoded.toString(), "hex");
  throw new Error("weixin_invalid_media_key");
}
export function crypt(data: Buffer, key: Buffer, decrypt = false): Buffer {
  const cipher = decrypt
    ? createDecipheriv("aes-128-ecb", key, null)
    : createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}
async function boundedBody(response: Response): Promise<Buffer> {
  if (!response.ok) throw new Error(`weixin_media_http_${response.status}`);
  if (Number(response.headers.get("content-length")) > MAX_MEDIA_BYTES + 16) {
    await response.body?.cancel();
    throw new Error("weixin_media_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("weixin_media_empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_MEDIA_BYTES + 16)
        throw new Error("weixin_media_too_large");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
export async function readLocalFile(file: string): Promise<Buffer> {
  if (!path.isAbsolute(file))
    throw new Error("weixin_absolute_file_path_required");
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MEDIA_BYTES)
      throw new Error("weixin_media_size_invalid");
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const result = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (!result.bytesRead) break;
      size += result.bytesRead;
    }
    if (size > stat.size) throw new Error("weixin_file_changed");
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}
export async function downloadMedia(
  api: WeixinApi,
  item: Item,
  root: string,
  id: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const content =
    item.image_item ?? item.voice_item ?? item.file_item ?? item.video_item;
  const media = content?.media;
  if (!media) return undefined;
  const url =
    media.full_url ||
    (media.encrypt_query_param
      ? `${CDN_BASE}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`
      : "");
  if (!url) throw new Error("weixin_media_url_missing");
  const response = await api.fetcher(weixinUrl(url), {
    redirect: "error",
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  let bytes = await boundedBody(response);
  if (item.image_item?.aeskey) {
    if (!/^[a-f0-9]{32}$/i.test(item.image_item.aeskey))
      throw new Error("weixin_invalid_media_key");
    bytes = crypt(bytes, Buffer.from(item.image_item.aeskey, "hex"), true);
  } else if (media.aes_key)
    bytes = crypt(bytes, decodeKey(media.aes_key), true);
  else if (!item.image_item) throw new Error("weixin_media_key_missing");
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES)
    throw new Error("weixin_media_size_invalid");
  const wav = item.type === 3 ? await voiceToWav(bytes) : undefined;
  if (wav) bytes = wav;
  signal.throwIfAborted();
  const fallback =
    item.type === 2
      ? "image.jpg"
      : item.type === 3
        ? wav
          ? "voice.wav"
          : "voice.silk"
        : item.type === 5
          ? "video.mp4"
          : "file.bin";
  const name =
    path
      .basename((item.file_item?.file_name || fallback).replaceAll("\\", "/"))
      .replace(/[^\p{L}\p{N}._-]/gu, "_")
      .slice(-120) || fallback;
  const file = path.join(
    root,
    `${createHash("sha256").update(id).digest("hex")}-${name}`,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  await pruneMedia(root, 256 * 1024 * 1024 - bytes.length);
  await writeFile(file, bytes, { mode: 0o600 });
  return file;
}
export async function uploadMedia(
  api: WeixinApi,
  config: WeixinConfig,
  file: string,
  signal: AbortSignal,
): Promise<unknown> {
  const data = await readLocalFile(file);
  const ext = path.extname(file).toLowerCase();
  const kind = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)
    ? "image"
    : [".mp4", ".mov", ".webm"].includes(ext)
      ? "video"
      : "file";
  const key = randomBytes(16);
  const filekey = randomBytes(16).toString("hex");
  const ciphertext = crypt(data, key);
  const upload = await api.call<{
    upload_full_url?: string;
    upload_param?: string;
  }>(
    config,
    "getuploadurl",
    {
      filekey,
      media_type: kind === "image" ? 1 : kind === "video" ? 2 : 3,
      to_user_id: config.userId,
      rawsize: data.length,
      rawfilemd5: createHash("md5").update(data).digest("hex"),
      filesize: ciphertext.length,
      no_need_thumb: true,
      aeskey: key.toString("hex"),
    },
    signal,
  );
  const url =
    upload.upload_full_url ||
    (upload.upload_param
      ? `${CDN_BASE}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${filekey}`
      : "");
  if (!url) throw new Error("weixin_upload_url_missing");
  const response = await api.fetcher(weixinUrl(url), {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(ciphertext),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  });
  if (!response.ok) throw new Error(`weixin_upload_http_${response.status}`);
  const param = response.headers.get("x-encrypted-param");
  if (!param) throw new Error("weixin_upload_not_confirmed");
  const media = {
    encrypt_query_param: param,
    aes_key: Buffer.from(key.toString("hex")).toString("base64"),
    encrypt_type: 1,
  };
  if (kind === "image")
    return { type: 2, image_item: { media, mid_size: ciphertext.length } };
  if (kind === "video")
    return { type: 5, video_item: { media, video_size: ciphertext.length } };
  return {
    type: 4,
    file_item: {
      media,
      file_name: path.basename(file),
      len: String(data.length),
    },
  };
}

/** Download cache only: never prunes user-selected outbound files. */
export async function pruneMedia(
  root: string,
  budget: number,
  now = Date.now(),
): Promise<void> {
  const entries = await readdir(root);
  const files = await Promise.all(
    entries.map(async (name) => {
      const file = path.join(root, name);
      const stat = await lstat(file);
      return { file, stat };
    }),
  );
  const regular = files
    .filter((entry) => entry.stat.isFile())
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);
  let size = regular.reduce((total, entry) => total + entry.stat.size, 0);
  for (const entry of regular) {
    if (entry.stat.mtimeMs < now - 7 * 86400_000 || size > budget) {
      await unlink(entry.file);
      size -= entry.stat.size;
    }
  }
}
