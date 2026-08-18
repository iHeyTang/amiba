import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type AmibaAttachmentKind = "image" | "text" | "pdf";

export interface AmibaAttachmentRecord {
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  kind: AmibaAttachmentKind;
  createdAt: string;
}

export interface AmibaStoredAttachment extends AmibaAttachmentRecord {
  data: Uint8Array;
}

const ATTACHMENT_ID = /^att_[0-9a-f]{32}$/u;
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function sanitizeName(value: string): string {
  const normalized = path.basename(value.trim()).slice(0, 255);
  return normalized || "file";
}

function assertAttachmentId(value: string): string {
  if (!ATTACHMENT_ID.test(value)) throw new Error("Invalid attachment id.");
  return value;
}

function decodeBase64(value: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("Attachment data is not valid base64.");
  }
  const data = Buffer.from(value, "base64");
  if (data.byteLength <= 0) throw new Error("Attachment is empty.");
  if (data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 50 MB limit.");
  }
  return new Uint8Array(data);
}

/** DSH-owned opaque object store. No caller-controlled path reaches fs APIs. */
export class AmibaAttachmentStore {
  private readonly objectRoot: string;
  private readonly metadataRoot: string;

  constructor(root: string) {
    this.objectRoot = path.join(path.resolve(root), "v1", "objects");
    this.metadataRoot = path.join(path.resolve(root), "v1", "metadata");
  }

  private objectPath(attachmentId: string): string {
    return path.join(this.objectRoot, `${assertAttachmentId(attachmentId)}.bin`);
  }

  private metadataPath(attachmentId: string): string {
    return path.join(this.metadataRoot, `${assertAttachmentId(attachmentId)}.json`);
  }

  async put(input: {
    name: string;
    mime: string;
    kind: AmibaAttachmentKind;
    dataBase64: string;
  }): Promise<AmibaAttachmentRecord> {
    const data = decodeBase64(input.dataBase64);
    const attachmentId = `att_${randomUUID().replaceAll("-", "")}`;
    const record: AmibaAttachmentRecord = {
      attachmentId,
      name: sanitizeName(input.name),
      mime: input.mime.trim().toLowerCase() || "application/octet-stream",
      size: data.byteLength,
      kind: input.kind,
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      mkdir(this.objectRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.metadataRoot, { recursive: true, mode: 0o700 }),
    ]);
    const nonce = randomUUID();
    const objectTarget = this.objectPath(attachmentId);
    const metadataTarget = this.metadataPath(attachmentId);
    const objectTemp = `${objectTarget}.${nonce}.tmp`;
    const metadataTemp = `${metadataTarget}.${nonce}.tmp`;
    try {
      await writeFile(objectTemp, data, { flag: "wx", mode: 0o600 });
      await writeFile(metadataTemp, `${JSON.stringify(record)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(objectTemp, objectTarget);
      await rename(metadataTemp, metadataTarget);
      return record;
    } catch (error) {
      await Promise.allSettled([unlink(objectTemp), unlink(metadataTemp)]);
      throw error;
    }
  }

  async read(attachmentId: string): Promise<AmibaStoredAttachment> {
    const metadataTarget = this.metadataPath(attachmentId);
    const objectTarget = this.objectPath(attachmentId);
    const [metadataInfo, objectInfo] = await Promise.all([
      lstat(metadataTarget),
      lstat(objectTarget),
    ]);
    if (
      metadataInfo.isSymbolicLink() ||
      objectInfo.isSymbolicLink() ||
      !metadataInfo.isFile() ||
      !objectInfo.isFile()
    ) {
      throw new Error("Attachment object is invalid.");
    }
    if (objectInfo.size <= 0 || objectInfo.size > MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment object has an invalid size.");
    }
    const [metadataSource, data] = await Promise.all([
      readFile(metadataTarget, "utf8"),
      readFile(objectTarget),
    ]);
    const record = JSON.parse(metadataSource) as AmibaAttachmentRecord;
    if (
      record.attachmentId !== attachmentId ||
      record.size !== data.byteLength ||
      !["image", "text", "pdf"].includes(record.kind)
    ) {
      throw new Error("Attachment metadata does not match its object.");
    }
    return { ...record, data: new Uint8Array(data) };
  }

  async remove(attachmentId: string): Promise<{ attachmentId: string; deleted: boolean }> {
    assertAttachmentId(attachmentId);
    const outcomes = await Promise.allSettled([
      unlink(this.objectPath(attachmentId)),
      unlink(this.metadataPath(attachmentId)),
    ]);
    let deleted = false;
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") {
        deleted = true;
        continue;
      }
      if ((outcome.reason as NodeJS.ErrnoException).code !== "ENOENT") {
        throw outcome.reason;
      }
    }
    return { attachmentId, deleted };
  }
}
