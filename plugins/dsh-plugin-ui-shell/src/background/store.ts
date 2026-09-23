import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
  assetIdSchema,
  backgroundConfigSchema,
  DEFAULT_BACKGROUND,
  MAX_BACKGROUND_BYTES,
  BACKGROUND_CHUNK_BYTES,
  isVideo,
  type BackgroundAsset,
  type BackgroundConfig,
  type BackgroundSnapshot,
} from "./model.js";

/** Sniff actual bytes: never serve executable SVG/HTML under an image MIME. */
export function mediaType(data: Buffer): { extension: string; mime: string } {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { extension: "png", mime: "image/png" };
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return { extension: "jpg", mime: "image/jpeg" };
  if (
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return { extension: "webp", mime: "image/webp" };
  if (
    data.toString("ascii", 4, 8) === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(data.toString("ascii", 8, 12))
  )
    return { extension: "mp4", mime: "video/mp4" };
  if (
    data.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
    data.subarray(0, 256).includes(Buffer.from("webm"))
  )
    return { extension: "webm", mime: "video/webm" };
  throw new Error("Unsupported background. Use PNG, JPEG, WebP, MP4 or WebM.");
}
export class BackgroundStore {
  private queue = Promise.resolve();
  private uploads = new Map<
    string,
    { bytes: number; offset: number; chunks: Buffer[]; touched: number }
  >();
  constructor(readonly root: string) {}
  private async read(): Promise<BackgroundSnapshot> {
    let raw: string;
    try {
      raw = await readFile(join(this.root, "background.json"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { revision: 0, config: { ...DEFAULT_BACKGROUND } };
      throw error;
    }
    const value = JSON.parse(raw);
    if (!Number.isSafeInteger(value.revision) || value.revision < 0)
      throw new Error("Invalid background revision");
    return {
      revision: value.revision,
      config: backgroundConfigSchema.parse(value.config),
    };
  }
  async get() {
    await this.queue;
    return this.read();
  }
  async configure(input: BackgroundConfig, revision: number) {
    const config = backgroundConfigSchema.parse(input);
    if (config.enabled && !config.assetId)
      throw new Error("Choose a background first");
    if (config.posterId && isVideo(config.posterId))
      throw new Error("Poster must be an image");
    const run = this.queue.then(async () => {
      const previous = await this.read();
      if (previous.revision !== revision)
        throw new Error("Background changed elsewhere. Refresh and retry.");
      for (const id of [config.assetId, config.posterId])
        if (id) await stat(this.assetPath(id));
      const next = { revision: revision + 1, config };
      await mkdir(this.root, { recursive: true });
      const temp = join(this.root, `background.${randomUUID()}.tmp`);
      try {
        await writeFile(temp, JSON.stringify(next));
        await rename(temp, join(this.root, "background.json"));
      } finally {
        await rm(temp, { force: true });
      }
      return next;
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  private assetPath(id: string) {
    return join(this.root, "assets", assetIdSchema.parse(id));
  }
  private async save(data: Buffer): Promise<BackgroundAsset> {
    if (!data.length || data.length > MAX_BACKGROUND_BYTES)
      throw new Error("Background must be 1 byte–64 MiB");
    const { extension, mime } = mediaType(data);
    const id = `${createHash("sha256").update(data).digest("hex")}.${extension}`;
    await mkdir(join(this.root, "assets"), { recursive: true });
    const temp = join(this.root, "assets", `${randomUUID()}.tmp`);
    try {
      await writeFile(temp, data);
      await rename(temp, this.assetPath(id));
    } finally {
      await rm(temp, { force: true });
    }
    return { id, mime, bytes: data.length };
  }
  /** The Agent supplies an explicit local artifact path; copy before activating so temporary media can expire. */
  async importFile(path: string) {
    const file = await open(path, "r");
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > MAX_BACKGROUND_BYTES)
        throw new Error("Expected a media file up to 64 MiB");
      const buffer = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < buffer.length) {
        const read = await file.read(
          buffer,
          offset,
          buffer.length - offset,
          offset,
        );
        if (!read.bytesRead) throw new Error("Media changed during import");
        offset += read.bytesRead;
      }
      return await this.save(buffer);
    } finally {
      await file.close();
    }
  }
  beginUpload(bytes: number) {
    for (const [id, upload] of this.uploads)
      if (Date.now() - upload.touched > 120_000) this.uploads.delete(id);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 1 ||
      bytes > MAX_BACKGROUND_BYTES ||
      this.uploads.size >= 2
    )
      throw new Error("Upload limit exceeded (64 MiB, two pending uploads)");
    const id = randomUUID();
    this.uploads.set(id, { bytes, offset: 0, chunks: [], touched: Date.now() });
    return id;
  }
  upload(id: string, offset: number, data: string) {
    const upload = this.uploads.get(id);
    if (
      !upload ||
      upload.offset !== offset ||
      data.length > 4 * Math.ceil(BACKGROUND_CHUNK_BYTES / 3) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
    )
      throw new Error("Invalid upload chunk");
    const chunk = Buffer.from(data, "base64");
    if (
      !chunk.length ||
      chunk.length > BACKGROUND_CHUNK_BYTES ||
      offset + chunk.length > upload.bytes
    )
      throw new Error("Invalid upload size");
    upload.chunks.push(chunk);
    upload.offset += chunk.length;
    upload.touched = Date.now();
    return upload.offset;
  }
  async finishUpload(id: string) {
    const upload = this.uploads.get(id);
    if (!upload || upload.bytes !== upload.offset)
      throw new Error("Incomplete upload");
    this.uploads.delete(id);
    return this.save(Buffer.concat(upload.chunks));
  }
  async asset(id: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid offset");
    const file = await open(this.assetPath(id), "r");
    try {
      const { size } = await file.stat();
      if (size > MAX_BACKGROUND_BYTES || offset >= size)
        throw new Error("Invalid asset size or offset");
      const header = Buffer.alloc(256);
      await file.read(header, 0, 256, 0);
      const { mime } = mediaType(header);
      const buffer = Buffer.alloc(
        Math.min(BACKGROUND_CHUNK_BYTES, size - offset),
      );
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return {
        data: buffer.subarray(0, bytesRead).toString("base64"),
        mime,
        bytes: size,
      };
    } finally {
      await file.close();
    }
  }
  dispose() {
    this.uploads.clear();
  }
}
