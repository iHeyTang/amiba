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
  /** Durable message references; draft cleanup must not erase these bytes. */
  retainedBy?: string[];
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
  private readonly writes = new Map<string, Promise<unknown>>();
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
      !["image", "text", "pdf"].includes(record.kind) ||
      (record.retainedBy !== undefined && (!Array.isArray(record.retainedBy) || record.retainedBy.some(id => typeof id !== "string" || !id)))
    ) {
      throw new Error("Attachment metadata does not match its object.");
    }
    return { ...record, data: new Uint8Array(data) };
  }

  private serial<T>(attachmentId: string, operation: () => Promise<T>): Promise<T> {
    assertAttachmentId(attachmentId);
    const previous = this.writes.get(attachmentId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.writes.set(attachmentId, next);
    void next.finally(() => {
      if (this.writes.get(attachmentId) === next) this.writes.delete(attachmentId);
    }).catch(() => {});
    return next;
  }

  async retainForSession(attachmentId: string, sessionId: string): Promise<void> {
    if (!sessionId.trim() || sessionId.length > 512 || /[\x00-\x1f]/u.test(sessionId)) throw new Error("Invalid attachment session id.");
    return this.serial(attachmentId, async () => {
      const { data: _data, ...record } = await this.read(attachmentId);
      if (record.retainedBy?.includes(sessionId)) return;
      const next = { ...record, retainedBy: [...(record.retainedBy ?? []), sessionId] };
      const target = this.metadataPath(attachmentId);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(next)}\n`, { flag: "wx", mode: 0o600 });
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
      }
    });
  }

  async remove(attachmentId: string): Promise<{ attachmentId: string; deleted: boolean }> {
    return this.serial(attachmentId, async () => {
      try {
        const record = await this.read(attachmentId);
        if (record.retainedBy?.length) return { attachmentId, deleted: false };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
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
    });
  }
}
